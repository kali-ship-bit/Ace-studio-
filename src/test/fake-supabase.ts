/**
 * Test helper: an in-memory fake of the small slice of the Supabase JS
 * client that the app uses (Postgres queries + Storage upload/download).
 * NEVER imported by app code — tests only.
 */

export type FakeRow = Record<string, unknown>;

export class FakeTable {
  rows: FakeRow[] = [];
  private seq = 0;

  nextId(prefix = "row"): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }
}

export class FakeQueryBuilder {
  private filters: Array<(r: FakeRow) => boolean> = [];
  private mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private insertRows: FakeRow[] = [];
  private upsertRow: FakeRow | null = null;
  private upsertConflict: string | null = null;
  private patch: FakeRow = {};
  private orders: Array<{ col: string; asc: boolean }> = [];
  private limitN: number | null = null;
  private wantSingle = false;
  private wantMaybeSingle = false;

  constructor(private table: FakeTable) {}

  select(_cols = "*"): this {
    return this;
  }

  insert(rows: FakeRow | FakeRow[]): this {
    this.mode = "insert";
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(row: FakeRow, opts?: { onConflict?: string }): this {
    this.mode = "upsert";
    this.upsertRow = row;
    this.upsertConflict = opts?.onConflict ?? null;
    return this;
  }

  update(patch: FakeRow): this {
    this.mode = "update";
    this.patch = patch;
    return this;
  }

  delete(): this {
    this.mode = "delete";
    return this;
  }

  eq(col: string, value: unknown): this {
    this.filters.push((r) => r[col] === value);
    return this;
  }

  in(col: string, values: unknown[]): this {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }

  /** Numeric when both sides are numbers, otherwise string order.
   *  ISO timestamps compare correctly as strings. */
  private static compare(a: unknown, b: unknown): number {
    if (typeof a === "number" && typeof b === "number") return a - b;
    const sa = String(a ?? "");
    const sb = String(b ?? "");
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  lt(col: string, value: unknown): this {
    this.filters.push((r) => FakeQueryBuilder.compare(r[col], value) < 0);
    return this;
  }

  lte(col: string, value: unknown): this {
    this.filters.push((r) => FakeQueryBuilder.compare(r[col], value) <= 0);
    return this;
  }

  gt(col: string, value: unknown): this {
    this.filters.push((r) => FakeQueryBuilder.compare(r[col], value) > 0);
    return this;
  }

  gte(col: string, value: unknown): this {
    this.filters.push((r) => FakeQueryBuilder.compare(r[col], value) >= 0);
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  single(): this {
    this.wantSingle = true;
    return this;
  }

  maybeSingle(): this {
    this.wantMaybeSingle = true;
    return this;
  }

  private matching(): FakeRow[] {
    return this.table.rows.filter((r) => this.filters.every((f) => f(r)));
  }

  private finish(rows: FakeRow[]): { data: unknown; error: null } {
    if (this.wantSingle || this.wantMaybeSingle) {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  private execute(): { data: unknown; error: null } {
    if (this.mode === "insert") {
      const now = new Date().toISOString();
      const made = this.insertRows.map((row) => {
        const full: FakeRow = {
          ...row,
          id: row["id"] ?? this.table.nextId("job"),
          created_at: row["created_at"] ?? now,
          updated_at: row["updated_at"] ?? now,
        };
        this.table.rows.push(full);
        return full;
      });
      return this.finish(made);
    }
    if (this.mode === "upsert" && this.upsertRow) {
      const key = this.upsertConflict;
      const row = this.upsertRow;
      if (key) {
        const existing = this.table.rows.find((r) => r[key] === row[key]);
        if (existing) {
          Object.assign(existing, row);
          return this.finish([existing]);
        }
      }
      const full: FakeRow = { ...row };
      this.table.rows.push(full);
      return this.finish([full]);
    }
    if (this.mode === "update") {
      const matched = this.matching();
      for (const r of matched) Object.assign(r, this.patch);
      return this.finish(matched);
    }
    if (this.mode === "delete") {
      const matched = this.matching();
      this.table.rows = this.table.rows.filter((r) => !matched.includes(r));
      return this.finish(matched);
    }
    let rows = this.matching();
    if (this.orders.length > 0) {
      const orders = this.orders;
      rows = [...rows].sort((a, b) => {
        for (const { col, asc } of orders) {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          if (av === bv) continue;
          return asc ? (av < bv ? -1 : 1) : av > bv ? -1 : 1;
        }
        return 0;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return this.finish(rows);
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

export class FakeStorageBucket {
  files = new Map<string, { data: Uint8Array; contentType: string }>();

  async upload(
    path: string,
    body: unknown,
    opts?: { contentType?: string; upsert?: boolean },
  ): Promise<{ data: { path: string } | null; error: { message: string } | null }> {
    let bytes: Uint8Array;
    // ArrayBuffer.isView works across realms (jsdom vs Node); instanceof
    // Uint8Array does not.
    if (ArrayBuffer.isView(body)) {
      bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    } else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
    else if (typeof Blob !== "undefined" && body instanceof Blob) {
      bytes = new Uint8Array(await body.arrayBuffer());
    } else {
      bytes = new Uint8Array(0);
    }
    this.files.set(path, {
      data: bytes,
      contentType: opts?.contentType ?? "application/octet-stream",
    });
    return { data: { path }, error: null };
  }

  async download(path: string): Promise<{
    data: { arrayBuffer(): Promise<ArrayBuffer> } | null;
    error: { message: string } | null;
  }> {
    const found = this.files.get(path);
    if (!found) return { data: null, error: { message: "not found" } };
    // A minimal Blob-like: the app only ever calls .arrayBuffer() on a
    // download. (jsdom's real Blob lacks arrayBuffer, so the fake does not
    // use one.)
    const bytes = found.data;
    return {
      data: {
        arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
      },
      error: null,
    };
  }
}

export interface FakeSupabaseClient {
  tables: Map<string, FakeTable>;
  buckets: Map<string, FakeStorageBucket>;
  from: (table: string) => FakeQueryBuilder;
  storage: { from: (bucket: string) => FakeStorageBucket };
}

export function createFakeSupabaseClient(): FakeSupabaseClient {
  const tables = new Map<string, FakeTable>();
  const buckets = new Map<string, FakeStorageBucket>();
  return {
    tables,
    buckets,
    from: (table: string) => {
      if (!tables.has(table)) tables.set(table, new FakeTable());
      return new FakeQueryBuilder(tables.get(table) as FakeTable);
    },
    storage: {
      from: (bucket: string) => {
        if (!buckets.has(bucket)) buckets.set(bucket, new FakeStorageBucket());
        return buckets.get(bucket) as FakeStorageBucket;
      },
    },
  };
}
