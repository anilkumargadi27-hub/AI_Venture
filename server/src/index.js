import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import PDFDocument from 'pdfkit'
import nodemailer from 'nodemailer'
import { randomUUID } from 'node:crypto'
import { agentSpecs, generateReport, localReport } from './agents.js'
import { AgentRun, Message, Project, Report, User } from './models.js'

const app = express()
const PORT = Number(process.env.PORT || 4000)
const memory = { projects: new Map(), reports: new Map(), messages: new Map(), users: new Map() }
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(express.json({ limit: '1mb' }))
app.get('/api/health', (_req, res) => res.json({ ok: true, mode: mongoose.connection.readyState === 1 ? 'mongodb' : 'local', integrations: { ollama: process.env.OLLAMA_MODEL || 'llama3.1', tavily: !!process.env.TAVILY_API_KEY } }))

function tokenFor(user) { return jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'local-development-secret-change-me', { expiresIn: '7d' }) }
function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Sign in required' })
  try { req.user = jwt.verify(token, process.env.JWT_SECRET || 'local-development-secret-change-me'); next() } catch { return res.status(401).json({ error: 'Session expired' }) }
}
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body
    if (!email || !password || password.length < 8) return res.status(400).json({ error: 'Email and a password of at least 8 characters are required' })
    const hash = await bcrypt.hash(password, 12)
    const user = mongoose.connection.readyState === 1 ? await User.create({ name, email, password: hash }) : { id: randomUUID(), name, email, password: hash }
    if (!mongoose.connection.readyState) memory.users.set(user.id, user)
    res.status(201).json({ token: tokenFor(user), user: { id: user.id, name: user.name, email: user.email } })
  } catch (e) { res.status(400).json({ error: e.code === 11000 ? 'An account with this email already exists' : e.message }) }
})
app.post('/api/auth/login', async (req, res) => {
  const user = mongoose.connection.readyState === 1 ? await User.findOne({ email: req.body.email?.toLowerCase() }) : [...memory.users.values()].find(u => u.email.toLowerCase() === req.body.email?.toLowerCase())
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password))) return res.status(401).json({ error: 'Email or password is incorrect' })
  res.json({ token: tokenFor(user), user: { id: user.id, name: user.name, email: user.email } })
})
app.get('/api/projects', auth, async (req, res) => {
  const projects = mongoose.connection.readyState === 1 ? await Project.find({ owner: req.user.id }).sort({ updatedAt: -1 }) : [...memory.projects.values()].filter(p => p.owner === req.user.id)
  res.json({ projects })
})
app.post('/api/projects', async (req, res) => {
  try {
    const input = req.body
    if (!input.name?.trim() || !input.idea?.trim()) return res.status(400).json({ error: 'Venture name and idea are required' })
    const p = mongoose.connection.readyState === 1 ? await Project.create({ ...input }) : { ...input, id: randomUUID(), _id: randomUUID(), status: 'in-progress', score: 0, currentAgent: 0, createdAt: new Date(), updatedAt: new Date() }
    if (!mongoose.connection.readyState) memory.projects.set(String(p.id || p._id), p)
    res.status(201).json({ project: p })
  } catch (e) { res.status(400).json({ error: e.message }) }
})
app.get('/api/projects/:id/reports', async (req, res) => {
  const reports = mongoose.connection.readyState === 1 ? await Report.find({ project: req.params.id }).sort({ createdAt: 1 }) : memory.reports.get(req.params.id) || []
  res.json({ reports })
})
app.post('/api/projects/:id/agents/:agentId', async (req, res) => {
  const agent = agentSpecs.find(a => a.id === req.params.agentId)
  if (!agent) return res.status(404).json({ error: 'Unknown agent' })
  const project = mongoose.connection.readyState === 1 ? await Project.findById(req.params.id) : memory.projects.get(req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })
  const start = Date.now()
  const content = await generateReport(project, agent, { tavilyKey: process.env.TAVILY_API_KEY, ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434', ollamaModel: process.env.OLLAMA_MODEL || 'llama3.1' })
  const report = mongoose.connection.readyState === 1 ? await Report.findOneAndUpdate({ project: project._id, agentId: agent.id }, { project: project._id, agentId: agent.id, key: agent.key, content, status: 'pending' }, { upsert: true, new: true }) : { id: randomUUID(), project: req.params.id, agentId: agent.id, key: agent.key, content, status: 'pending', createdAt: new Date() }
  if (mongoose.connection.readyState === 1) {
    await AgentRun.create({ project: project._id, agentId: agent.id, status: 'completed', durationMs: Date.now() - start })
  } else {
    memory.reports.set(req.params.id, [...(memory.reports.get(req.params.id) || []).filter(r => r.agentId !== agent.id), report])
  }
  res.json({ report })
})
app.post('/api/projects/:id/agents/:agentId/approve', async (req, res) => {
  const index = agentSpecs.findIndex(a => a.id === req.params.agentId)
  if (index < 0) return res.status(404).json({ error: 'Unknown agent' })
  if (mongoose.connection.readyState === 1) {
    const project = await Project.findById(req.params.id)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const report = await Report.findOneAndUpdate({ project: project._id, agentId: req.params.agentId }, { status: 'approved' }, { new: true })
    if (!report) return res.status(409).json({ error: 'Generate the report before approving it' })
    const currentAgent = Math.max(project.currentAgent || 0, index + 1)
    await Project.findByIdAndUpdate(project._id, { currentAgent, score: Math.min(98, 68 + currentAgent * 2), status: currentAgent >= agentSpecs.length ? 'completed' : 'in-progress' })
  } else {
    const project = memory.projects.get(req.params.id), reports = memory.reports.get(req.params.id) || []
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const report = reports.find(r => r.agentId === req.params.agentId)
    if (!report) return res.status(409).json({ error: 'Generate the report before approving it' })
    report.status = 'approved'; project.currentAgent = Math.max(project.currentAgent || 0, index + 1); project.score = Math.min(98, 68 + project.currentAgent * 2); project.status = project.currentAgent >= agentSpecs.length ? 'completed' : 'in-progress'
  }
  res.json({ approved: true })
})
app.post('/api/projects/:id/boardroom', async (req, res) => {
  const q = String(req.body.question || '').trim()
  if (!q) return res.status(400).json({ error: 'Add a question for the boardroom' })
  const roles = ['CEO', 'CTO', 'CFO', 'CMO', 'VC']
  const messages = roles.map((role, i) => ({ who: role, text: [`Let’s keep the decision anchored in the customer problem and what we have evidence for.`, `From a product and technology angle, test the riskiest assumption with the smallest useful experiment.`, `Model the downside first. Stage spend against proof points and keep enough runway to learn.`, `Choose one audience and channel to test a clear promise; measure qualified conversion, not just reach.`, `Investors will look for a specific wedge, credible traction signals, and a team that learns quickly.`][i] }))
  if (mongoose.connection.readyState === 1) await Message.insertMany([{ project: req.params.id, role: 'user', content: q }, ...messages.map(m => ({ project: req.params.id, role: m.who, content: m.text }))])
  else memory.messages.set(req.params.id, [...(memory.messages.get(req.params.id) || []), { who: 'You', text: q }, ...messages])
  res.json({ messages })
})
app.get('/api/projects/:id/export/pdf', async (req, res) => {
  const project = mongoose.connection.readyState === 1 ? await Project.findById(req.params.id) : memory.projects.get(req.params.id)
  if (!project) return res.status(404).json({ error: 'Project not found' })
  const reports = mongoose.connection.readyState === 1 ? await Report.find({ project: project._id }).sort({ createdAt: 1 }) : memory.reports.get(req.params.id) || []
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="venture-report.pdf"`)
  const doc = new PDFDocument({ margin: 55 }); doc.pipe(res)
  doc.fontSize(11).fillColor('#53623f').text('VENTURE STUDIO', { characterSpacing: 2 })
  doc.moveDown(3).fontSize(32).fillColor('#192018').text(project.name).moveDown(.5).fontSize(13).fillColor('#555').text(project.idea)
  doc.addPage().fontSize(23).fillColor('#192018').text('Executive summary').moveDown(.5).fontSize(11).fillColor('#333').text(`Industry: ${project.industry || 'Not specified'}\nTarget users: ${project.targetUsers || 'Not specified'}\nMarket: ${project.country || 'Not specified'}\nBudget: ${project.budget || 'Not specified'}\nTimeline: ${project.timeline || 'Not specified'}`)
  for (const report of reports) { doc.addPage().fontSize(21).fillColor('#192018').text(agentSpecs.find(a => a.id === report.agentId)?.name || report.agentId).moveDown(.7).fontSize(10).fillColor('#333').text(report.content, { lineGap: 4 }) }
  doc.end()
})
app.post('/api/projects/:id/email', async (req, res) => {
  const { email } = req.body
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return res.status(503).json({ error: 'Configure SMTP_HOST, SMTP_USER, and SMTP_PASS to send email' })
  if (!email) return res.status(400).json({ error: 'Recipient email is required' })
  const project = mongoose.connection.readyState === 1 ? await Project.findById(req.params.id) : memory.projects.get(req.params.id)
  const reports = mongoose.connection.readyState === 1 ? await Report.find({ project: project?._id }) : memory.reports.get(req.params.id) || []
  if (!project) return res.status(404).json({ error: 'Project not found' })
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
  const md = reports.map(r => `# ${r.key}\n\n${r.content}`).join('\n\n---\n\n')
  await transport.sendMail({ from: process.env.SMTP_FROM, to: email, subject: `${project.name} — Venture Studio blueprint`, text: 'Your venture blueprint is attached.', attachments: [{ filename: 'venture-blueprint.md', content: md }] })
  res.json({ sent: true })
})
app.get('/api/projects/:id/memory', async (req, res) => {
  const query = String(req.query.q || '').toLowerCase()
  const reports = mongoose.connection.readyState === 1 ? await Report.find({ project: req.params.id }) : memory.reports.get(req.params.id) || []
  const results = reports.filter(r => !query || `${r.key} ${r.content}`.toLowerCase().includes(query))
  res.json({ results })
})
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Something went wrong. Check the server logs.' }) })

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/venture-studio', { serverSelectionTimeoutMS: 1800 }).then(() => console.log('MongoDB connected')).catch(() => console.log('MongoDB unavailable; using local in-memory storage'))
app.listen(PORT, () => console.log(`Venture Studio API listening on http://localhost:${PORT}`))
