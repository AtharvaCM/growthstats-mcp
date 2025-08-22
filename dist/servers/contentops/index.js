import fetch from 'node-fetch';
import { Server } from '@modelcontextprotocol/sdk/dist/server/index';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/dist/server/stdio';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/dist/types';
function createServer(info) {
    const server = new Server(info, { capabilities: { tools: {} } });
    const tools = new Map();
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: Array.from(tools.values()).map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema
        }))
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const tool = tools.get(req.params.name);
        if (!tool)
            throw new Error(`Tool not found: ${req.params.name}`);
        const result = await tool.run(req.params.arguments || {});
        return { result };
    });
    return {
        tools,
        addTool: (tool) => {
            tools.set(tool.name, tool);
        },
        start: async () => {
            await server.connect(new StdioServerTransport());
        }
    };
}
const sanityBase = `https://${process.env.SANITY_PROJECT_ID}.api.sanity.io/v2023-08-01/data`;
const dataset = process.env.SANITY_DATASET;
const sanityToken = process.env.SANITY_TOKEN;
const revalidateUrl = process.env.NEXT_REVALIDATE_URL;
const revalidateSecret = process.env.NEXT_REVALIDATE_SECRET;
const server = createServer({ name: 'Growthstats ContentOps', version: '0.1.0' });
server.addTool({
    name: 'sanity.query',
    description: 'Run a GROQ query (read-only).',
    inputSchema: {
        type: 'object',
        properties: { groq: { type: 'string' }, params: { type: 'object' } },
        required: ['groq']
    },
    run: async ({ groq, params }) => {
        const url = `${sanityBase}/query/${dataset}?query=${encodeURIComponent(groq)}&${params ? 'params=' + encodeURIComponent(JSON.stringify(params)) : ''}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${sanityToken}` } });
        if (!res.ok)
            throw new Error(`Sanity query failed: ${res.status}`);
        return await res.json();
    }
});
server.addTool({
    name: 'content.audit',
    description: 'Audit docs for missing seo.title/description, slug, og:image, and missing alt text.',
    inputSchema: { type: 'object', properties: { docType: { type: 'string' } }, required: ['docType'] },
    run: async ({ docType }) => {
        const groq = `*[_type == $t]{_id, title, "slug": slug.current, seo, "images": images[]{..., asset->{metadata{lqip}}}}`;
        const data = await server.tools.get('sanity.query').run({ groq, params: { t: docType } });
        const issues = (data.result || []).map((d) => {
            const problems = [];
            if (!d.slug)
                problems.push('missing slug');
            if (!d.seo?.title)
                problems.push('missing seo.title');
            if (!d.seo?.description)
                problems.push('missing seo.description');
            const imgs = (d.images || []).filter((i) => !i.alt);
            if (imgs.length)
                problems.push(`images missing alt: ${imgs.length}`);
            return problems.length ? { id: d._id, title: d.title, problems } : null;
        }).filter(Boolean);
        return { count: issues.length, issues };
    }
});
server.addTool({
    name: 'next.revalidate',
    description: 'Trigger ISR revalidation for a slug.',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
    run: async ({ slug }) => {
        const res = await fetch(revalidateUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': revalidateSecret },
            body: JSON.stringify({ slug })
        });
        const body = await res.text();
        if (!res.ok)
            throw new Error(`Revalidate failed: ${res.status} ${body}`);
        return { ok: true, body };
    }
});
server.start();
