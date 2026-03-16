import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { drizzle, type SQLJsDatabase } from "drizzle-orm/sql-js";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const STORAGE_KEY = "chat.sqlite.base64";

const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
});

type ChatMessageRecord = typeof chatMessages.$inferSelect;

type ChatMessageInsert = Pick<ChatMessageRecord, "id" | "role" | "content"> & {
  createdAt?: number;
};

type DbContext = {
  sqlite: Database;
  orm: SQLJsDatabase;
};

let contextPromise: Promise<DbContext> | null = null;

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function persist(sqlite: Database) {
  const bytes = sqlite.export();
  localStorage.setItem(STORAGE_KEY, encodeBase64(bytes));
}

async function getContext(): Promise<DbContext> {
  if (contextPromise) return contextPromise;

  contextPromise = (async () => {
    const SQL = await initSqlJs({
      locateFile: () => wasmUrl,
    });

    const saved = localStorage.getItem(STORAGE_KEY);

    let sqlite: Database;
    if (saved) {
      try {
        sqlite = new SQL.Database(decodeBase64(saved));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        sqlite = new SQL.Database();
      }
    } else {
      sqlite = new SQL.Database();
    }

    const orm = drizzle(sqlite);

    orm.run(sql`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    persist(sqlite);
    return { sqlite, orm };
  })();

  return contextPromise;
}

export async function listStoredMessages() {
  const { orm } = await getContext();
  return orm
    .select()
    .from(chatMessages)
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
}

export async function createStoredMessage(message: ChatMessageInsert) {
  const { orm, sqlite } = await getContext();

  await orm.insert(chatMessages).values({
    ...message,
    createdAt: message.createdAt ?? Date.now(),
  });

  persist(sqlite);
}

export async function updateStoredMessageContent(id: string, content: string) {
  const { orm, sqlite } = await getContext();

  await orm
    .update(chatMessages)
    .set({ content })
    .where(eq(chatMessages.id, id));

  persist(sqlite);
}

export async function deleteStoredMessage(id: string) {
  const { orm, sqlite } = await getContext();

  await orm.delete(chatMessages).where(eq(chatMessages.id, id));

  persist(sqlite);
}

export async function clearStoredMessages() {
  const { orm, sqlite } = await getContext();

  await orm.delete(chatMessages);
  persist(sqlite);
}

export async function deleteStoredMessagesByIds(ids: string[]) {
  if (ids.length === 0) return;

  const { orm, sqlite } = await getContext();
  await orm.delete(chatMessages).where(inArray(chatMessages.id, ids));
  persist(sqlite);
}
