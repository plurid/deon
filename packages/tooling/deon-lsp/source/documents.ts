// The open documents, held in memory. The editor is the source of truth: it sends the full text on
// open and the full text on every change (the server advertises full-text sync, so a change carries
// the whole document, not a delta), and the server never reads a file from disk — an editor's
// unsaved buffer is exactly what the author sees, and it is what a diagnostic must be about.

// #region module
export interface TextDocument {
    uri: string;
    version: number;
    text: string;
}


export class Documents {
    private readonly open = new Map<string, TextDocument>();

    public opened(
        uri: string,
        version: number,
        text: string,
    ): void {
        this.open.set(uri, { uri, version, text });
    }

    /**
     * Full-text sync: the change carries the entire new text. A change with no full-content range is
     * the whole document; a ranged change is not requested, because the server does not advertise it.
     */
    public changed(
        uri: string,
        version: number,
        text: string,
    ): void {
        this.open.set(uri, { uri, version, text });
    }

    public closed(
        uri: string,
    ): void {
        this.open.delete(uri);
    }

    public get(
        uri: string,
    ): TextDocument | undefined {
        return this.open.get(uri);
    }
}
// #endregion module
