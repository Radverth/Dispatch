import * as vscode from 'vscode';
import { Message } from './apiClient';

export interface DisplayMessage {
  role: 'user' | 'assistant' | 'error';
  text: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: DisplayMessage[];
  apiHistory: Message[];
  createdAt: number;
}

const KEY_SESSIONS   = 'dispatch.chatSessions';
const KEY_ACTIVE     = 'dispatch.activeChatId';
const MAX_SESSIONS   = 20;
const MAX_API_PAIRS  = 10; // 10 user+assistant pairs = 20 messages

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export class ChatHistory {
  constructor(private readonly state: vscode.Memento) {}

  getSessions(): ChatSession[] {
    return this.state.get<ChatSession[]>(KEY_SESSIONS) ?? [];
  }

  getActiveId(): string | undefined {
    return this.state.get<string>(KEY_ACTIVE);
  }

  getActive(): ChatSession | undefined {
    const id = this.getActiveId();
    return this.getSessions().find(s => s.id === id);
  }

  async newSession(): Promise<ChatSession> {
    const session: ChatSession = {
      id: makeId(),
      title: 'New chat',
      messages: [],
      apiHistory: [],
      createdAt: Date.now(),
    };
    const sessions = [session, ...this.getSessions()].slice(0, MAX_SESSIONS);
    await this.state.update(KEY_SESSIONS, sessions);
    await this.state.update(KEY_ACTIVE, session.id);
    return session;
  }

  async setActive(id: string): Promise<ChatSession | undefined> {
    const session = this.getSessions().find(s => s.id === id);
    if (!session) return undefined;
    await this.state.update(KEY_ACTIVE, id);
    return session;
  }

  async addMessage(sessionId: string, display: DisplayMessage, apiHistory: Message[]): Promise<void> {
    const sessions = this.getSessions();
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) return;
    const session = { ...sessions[idx] };
    session.messages = [...session.messages, display];
    if (session.title === 'New chat' && display.role === 'user') {
      session.title = display.text.slice(0, 50) + (display.text.length > 50 ? '…' : '');
    }
    session.apiHistory = apiHistory.slice(-(MAX_API_PAIRS * 2));
    sessions[idx] = session;
    await this.state.update(KEY_SESSIONS, sessions);
  }

  async deleteSession(id: string): Promise<void> {
    const sessions = this.getSessions().filter(s => s.id !== id);
    await this.state.update(KEY_SESSIONS, sessions);
    if (this.getActiveId() === id) {
      await this.state.update(KEY_ACTIVE, sessions[0]?.id);
    }
  }

  async ensureActive(): Promise<ChatSession> {
    return this.getActive() ?? this.newSession();
  }

  summaryList(): Array<{ id: string; title: string; isActive: boolean }> {
    const activeId = this.getActiveId();
    return this.getSessions().map(s => ({
      id: s.id,
      title: s.title,
      isActive: s.id === activeId,
    }));
  }
}
