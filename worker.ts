import { IncomingRequestCf, R2Object, R2ObjectBody, R2ListOptions } from './deps.ts';
import { computeDirectoryListingHtml } from './listing.ts';
import { WorkerEnv } from './worker_env.d.ts';

export default {
    async fetch(request: IncomingRequestCf, env: WorkerEnv): Promise<Response> {
        try {
            return await computeResponse(request, env);
        } catch (e) {
            if (typeof e === 'object' && tryParseMessageCode(e.message) === 10039) { // The requested range is not satisfiable (10039)
                return new Response(e.message, { status: 416 });
            }
            return new Response(`${e.stack || e}`, { status: 500 });
        }
    }
};

declare global {
    interface ResponseInit {
        // non-standard cloudflare property, defaults to 'auto'
        encodeBody?: 'auto' | 'manual';
    }
}

const DIR_LIST_LIMIT = 1000;

function tryParseMessageCode(message: unknown): number | undefined {
    // The requested range is not satisfiable (10039)
    const m = /^.*?\((\d+)\)$/.exec(typeof message === 'string' ? message : '');
    return m ? parseInt(m[1]) : undefined;
}

async function computeResponse(request: IncomingRequestCf, env: WorkerEnv): Promise<Response> {
    const bucket = env.bucket;
    const allowCorsOrigins = stringSetFromCsv(env.allowCorsOrigins);

    const { method, url, headers } = request;

    if (method !== 'GET' && method !== 'HEAD') {
        return new Response(`Method '${method}' not allowed`, { status: 405 });
    }

    const { pathname, searchParams } = new URL(url);
    let key = pathname.substring(1); // strip leading slash
    key = decodeURIComponent(key);

    // special handling for robots.txt
    if (key === 'robots.txt') {
        return new Response(method === 'GET' ? 'User-agent: *\nDisallow: /' : undefined, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    let obj: R2Object | null = null;
    const getOrHead: (key: string) => Promise<R2Object | null> = (key) => {
        return method === 'GET' ? bucket.get(key) : bucket.head(key);
    };


    // first, try to request the object at the given key
    obj = key === '' ? null : await getOrHead(key);
    if (obj) {
        const accessControlAllowOrigin = computeAccessControlAllowOrigin(obj, headers.get('origin') ?? undefined, allowCorsOrigins);
        return computeObjResponse(obj, 200, accessControlAllowOrigin);
    }

    // R2 object not found, try listing a directory
    let prefix = pathname.substring(1);
    let redirect = false;
    if (prefix !== '' && !prefix.endsWith('/')) {
        prefix += '/';
        redirect = true;
    }

    const options: R2ListOptions = { delimiter: '/', limit: DIR_LIST_LIMIT, prefix: prefix === '' ? undefined : prefix, cursor: searchParams.get('cursor') || undefined };
    const objects = await bucket.list(options);
    if (objects.delimitedPrefixes.length > 0 || objects.objects.length > 0) {
        const { cursor } = objects;
        return redirect ? temporaryRedirect({ location: '/' + prefix }) : new Response(computeDirectoryListingHtml(objects, { prefix, cursor }), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    return notFound(method);
}

function stringSetFromCsv(value: string | undefined) {
    return new Set((value ?? '').split(',').map(v => v.trim()).filter(v => v !== ''));
}

function notFound(method: string): Response {
    return new Response(method === 'HEAD' ? undefined : 'not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function temporaryRedirect(opts: { location: string }): Response {
    const { location } = opts;
    return new Response(undefined, { status: 307, headers: { 'location': location } });
}

function isR2ObjectBody(obj: R2Object): obj is R2ObjectBody {
    return 'body' in obj;
}

function computeObjResponse(obj: R2Object, status: number, accessControlAllowOrigin?: string): Response {
    let body: ReadableStream | undefined;
    if (isR2ObjectBody(obj)) {
        body = obj.body;
    }

    const headers = new Headers();
    // writes content-type, content-encoding, content-disposition, i.e. the values from obj.httpMetadata
    obj.writeHttpMetadata(headers);

    // obj.size represents the full size, but seems to be clamped by the cf frontend down to the actual number of bytes in the partial response
    // exactly what we want in a content-length header
    headers.set('content-length', String(obj.size));

    if (accessControlAllowOrigin) headers.set('access-control-allow-origin', accessControlAllowOrigin);

    // non-standard cloudflare ResponseInit property indicating the response is already encoded
    // required to prevent the cf frontend from double-encoding it, or serving it encoded without a content-encoding header
    const encodeBody = headers.has('content-encoding') ? 'manual' : undefined;
    return new Response(body, { status, headers, encodeBody });
}

function computeAccessControlAllowOrigin(obj: R2Object, requestOrigin: string | undefined, allowCorsOrigins: Set<string>): string | undefined {
    // is request origin allowed?
    if (allowCorsOrigins.size === 0) {
        return undefined;
    }

    if (allowCorsOrigins.has('*')) {
        return '*';
    }

    if (requestOrigin && allowCorsOrigins.has(requestOrigin)) {
        return requestOrigin;
    }

    return undefined;
}
