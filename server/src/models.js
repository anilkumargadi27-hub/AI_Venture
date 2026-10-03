import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({ name: String, email: { type: String, unique: true, lowercase: true }, password: String }, { timestamps: true })
const projectSchema = new mongoose.Schema({ owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, name: { type: String, required: true }, idea: { type: String, required: true }, industry: String, targetUsers: String, country: String, budget: String, timeline: String, status: { type: String, default: 'in-progress' }, score: { type: Number, default: 0 }, currentAgent: { type: Number, default: 0 } }, { timestamps: true })
const reportSchema = new mongoose.Schema({ project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true }, agentId: String, key: String, content: String, status: { type: String, default: 'approved' } }, { timestamps: true })
const runSchema = new mongoose.Schema({ project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' }, agentId: String, status: String, durationMs: Number }, { timestamps: true })
const messageSchema = new mongoose.Schema({ project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' }, sessionId: String, role: String, content: String }, { timestamps: true })
export const User = mongoose.models.User || mongoose.model('User', userSchema)
export const Project = mongoose.models.Project || mongoose.model('Project', projectSchema)
export const Report = mongoose.models.Report || mongoose.model('Report', reportSchema)
export const AgentRun = mongoose.models.AgentRun || mongoose.model('AgentRun', runSchema)
export const Message = mongoose.models.Message || mongoose.model('Message', messageSchema)
