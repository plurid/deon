// The Language Server Protocol wire, implemented directly so the server carries no third-party
// dependency — the same discipline the seven Deon cores keep.
//
// A message is a JSON-RPC 2.0 object framed by an HTTP-like header: `Content-Length: N\r\n\r\n`
// followed by exactly `N` bytes of UTF-8 body. The length is measured in bytes, not characters, so a
// non-ASCII body frames correctly; the reader therefore works over a byte `Buffer` throughout and
// decodes only the body it has fully received.

// #region imports
    import type { Readable, Writable } from 'node:stream';
// #endregion imports



// #region module
export type JsonRpcId = number | string;

export interface RequestMessage {
    jsonrpc: '2.0';
    id: JsonRpcId;
    method: string;
    params?: unknown;
}

export interface NotificationMessage {
    jsonrpc: '2.0';
    method: string;
    params?: unknown;
}

export type RequestHandler = (params: any) => unknown | Promise<unknown>;
export type NotificationHandler = (params: any) => void | Promise<void>;


/**
 * Frame a JSON-RPC message for the wire. Exported so a test can speak the same protocol the server
 * does, rather than a hand-rolled approximation of it.
 */
export const encodeMessage = (
    message: object,
): Buffer => {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii');
    return Buffer.concat([header, body]);
};


/**
 * A JSON-RPC endpoint over a pair of byte streams. Requests carry an `id` and are answered; a
 * notification carries none and is not. The server both receives (from the editor) and sends (a
 * `publishDiagnostics`, an answer), so one object owns both directions.
 */
export class Connection {
    private pending = Buffer.alloc(0);
    private readonly requestHandlers = new Map<string, RequestHandler>();
    private readonly notificationHandlers = new Map<string, NotificationHandler>();

    constructor(
        private readonly input: Readable,
        private readonly output: Writable,
    ) {
        this.input.on('data', (chunk: Buffer | string) => {
            this.receive(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'));
        });
    }

    public onRequest(
        method: string,
        handler: RequestHandler,
    ): void {
        this.requestHandlers.set(method, handler);
    }

    public onNotification(
        method: string,
        handler: NotificationHandler,
    ): void {
        this.notificationHandlers.set(method, handler);
    }

    public sendNotification(
        method: string,
        params?: unknown,
    ): void {
        this.write({ jsonrpc: '2.0', method, params });
    }

    private write(
        message: object,
    ): void {
        this.output.write(encodeMessage(message));
    }

    private receive(
        chunk: Buffer,
    ): void {
        this.pending = Buffer.concat([this.pending, chunk]);

        // Drain every complete message the buffer now holds; a chunk may carry several, or a
        // fraction of one, so this loops and returns the moment a message is not yet whole.
        for (;;) {
            const headerEnd = this.pending.indexOf('\r\n\r\n');
            if (headerEnd === -1) {
                return;
            }

            const header = this.pending.subarray(0, headerEnd).toString('ascii');
            const length = /content-length:\s*(\d+)/i.exec(header);
            if (!length) {
                // A header with no length cannot be framed; drop it and resynchronise.
                this.pending = this.pending.subarray(headerEnd + 4);
                continue;
            }

            const bodyStart = headerEnd + 4;
            const bodyEnd = bodyStart + Number(length[1]);
            if (this.pending.length < bodyEnd) {
                return;
            }

            const body = this.pending.subarray(bodyStart, bodyEnd).toString('utf8');
            this.pending = this.pending.subarray(bodyEnd);

            let message: any;
            try {
                message = JSON.parse(body);
            } catch {
                continue;
            }

            void this.dispatch(message);
        }
    }

    private async dispatch(
        message: any,
    ): Promise<void> {
        const isRequest = typeof message?.method === 'string'
            && message.id !== undefined
            && message.id !== null;

        if (isRequest) {
            const handler = this.requestHandlers.get(message.method);
            if (!handler) {
                this.write({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: { code: -32601, message: `method not found: ${message.method}` },
                });
                return;
            }

            try {
                const result = await handler(message.params);
                this.write({ jsonrpc: '2.0', id: message.id, result: result ?? null });
            } catch (failure: any) {
                this.write({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: { code: -32603, message: String(failure?.message ?? failure) },
                });
            }
            return;
        }

        if (typeof message?.method === 'string') {
            const handler = this.notificationHandlers.get(message.method);
            if (handler) {
                try {
                    await handler(message.params);
                } catch {
                    // A notification has no reply, so a handler's failure is swallowed rather than
                    // sent back as an error to an id that does not exist.
                }
            }
        }
    }
}
// #endregion module
