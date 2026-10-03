export const agentSpecs = [
  { id: 'market', name: 'Market research', key: 'market_report', prompt: 'Estimate TAM, SAM, SOM, market trends, and industry structure.' },
  { id: 'competitor', name: 'Competitor analysis', key: 'competitor_report', prompt: 'Identify competitors, compare features and pricing, and create a SWOT analysis.' },
  { id: 'opportunity', name: 'Opportunity discovery', key: 'opportunity_report', prompt: 'Find market gaps, underserved segments, and promising niches.' },
  { id: 'product', name: 'Product strategy', key: 'product_strategy', prompt: 'Define personas, user stories, MVP scope, and feature priorities.' },
  { id: 'prd', name: 'PRD generation', key: 'prd', prompt: 'Write a concise product requirements document with goals and acceptance criteria.' },
  { id: 'architecture', name: 'Technical architecture', key: 'architecture', prompt: 'Design system architecture, database schema, API contracts, and folder structure.' },
  { id: 'revenue', name: 'Revenue model', key: 'revenue_model', prompt: 'Propose pricing, revenue streams, and subscription plans.' },
  { id: 'financial', name: 'Financial forecast', key: 'financials', prompt: 'Build a 3-year cost and revenue forecast with assumptions and break-even analysis.' },
  { id: 'gtm', name: 'Go-to-market', key: 'gtm', prompt: 'Create a launch plan, marketing channels, and customer acquisition strategy.' },
  { id: 'investor', name: 'Investor readiness', key: 'investor_report', prompt: 'Score the startup, assess investment readiness, and identify risks.' },
  { id: 'pitch', name: 'Pitch deck', key: 'pitch_deck', prompt: 'Create a 10–15 slide investor pitch deck outline with compelling evidence-led narrative.' },
]

export function localReport(project, agent) {
  return `# ${agent.name}: ${project.name}\n\n## Venture context\n${project.idea}\n\n## Analysis\n${agent.prompt}\n\nThe opportunity centers on ${project.targetUsers || 'a clearly defined first customer segment'} in ${project.industry || 'the target market'}, initially focused on ${project.country || 'the launch market'}. Treat any market sizing and financial estimates as hypotheses until validated with primary research.\n\n## Recommendations\n- Interview 10–15 target customers and document current alternatives.\n- Test willingness to pay with a small pilot before committing the full ${project.budget || 'available'} budget.\n- Track activation, retention, and acquisition cost from the first release.\n- Revisit assumptions on a ${project.timeline || '90-day'} validation timeline.\n\n## Key assumptions to validate\n1. The problem is urgent enough that customers will change their current behavior.\n2. A focused MVP can deliver a measurable outcome at sustainable cost.\n3. The initial acquisition channel can reach customers repeatably.\n\n*Prepared by Venture Studio. Validate estimates with current market sources before making investment decisions.*`
}

export async function generateReport(project, agent, { tavilyKey, ollamaUrl, ollamaModel }) {
  let research = ''
  if (tavilyKey && agent.id === 'market') {
    try {
      const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_key: tavilyKey, query: `${project.industry} market trends ${project.country}`, max_results: 5 }) })
      if (r.ok) { const data = await r.json(); research = (data.results || []).map(x => `- ${x.title}: ${x.content}`).join('\n') }
    } catch {}
  }
  try {
    const response = await fetch(`${ollamaUrl}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(120000), body: JSON.stringify({ model: ollamaModel, stream: false, prompt: `You are a pragmatic startup strategy analyst. Be specific, distinguish evidence from assumptions, and avoid inventing facts.\n\nProject: ${project.name}\nIdea: ${project.idea}\nIndustry: ${project.industry}\nTarget users: ${project.targetUsers}\nCountry: ${project.country}\nBudget: ${project.budget}\nTimeline: ${project.timeline}\n\nTask: ${agent.prompt}\n${research ? `\nSearch research (cite titles in text):\n${research}` : ''}\n\nWrite a useful Markdown report with findings, assumptions, risks, and prioritized next steps.` }) })
    if (response.ok) { const data = await response.json(); if (data.response) return data.response }
  } catch {}
  return localReport(project, agent)
}
