import { invoke } from "@tauri-apps/api/core";
import type { Ticket, AgentSession, AgentLog, PrComment, OpenCodeStatus } from "./types";

export async function getTickets(): Promise<Ticket[]> {
  return invoke<Ticket[]>("get_tickets");
}

export async function syncJiraNow(): Promise<number> {
  return invoke<number>("sync_jira_now");
}

export async function transitionTicket(key: string, transitionId: string): Promise<void> {
  return invoke("transition_ticket", { key, transitionId });
}

export async function getOpenCodeStatus(): Promise<OpenCodeStatus> {
  return invoke<OpenCodeStatus>("get_opencode_status");
}

export async function startTicketImplementation(ticketId: string): Promise<string> {
  return invoke<string>("start_ticket_implementation", { ticketId });
}

export async function approveCheckpoint(sessionId: string): Promise<void> {
  return invoke("approve_checkpoint", { sessionId });
}

export async function rejectCheckpoint(sessionId: string, feedback: string): Promise<void> {
  return invoke("reject_checkpoint", { sessionId, feedback });
}

export async function addressSelectedPrComments(ticketId: string, commentIds: number[]): Promise<string> {
  return invoke<string>("address_selected_pr_comments", { ticketId, commentIds });
}

export async function getSessionStatus(sessionId: string): Promise<AgentSession> {
  return invoke<AgentSession>("get_session_status", { sessionId });
}

export async function abortSession(sessionId: string): Promise<void> {
  return invoke("abort_session", { sessionId });
}

export async function getAgentLogs(sessionId: string): Promise<AgentLog[]> {
  return invoke<AgentLog[]>("get_agent_logs", { sessionId });
}

export async function pollPrCommentsNow(): Promise<number> {
  return invoke<number>("poll_pr_comments_now");
}

export async function getPrComments(prId: number): Promise<PrComment[]> {
  return invoke<PrComment[]>("get_pr_comments", { prId });
}

export async function markCommentAddressed(commentId: number): Promise<void> {
  return invoke("mark_comment_addressed", { commentId });
}

export async function getConfig(key: string): Promise<string | null> {
  return invoke<string | null>("get_config", { key });
}

export async function setConfig(key: string, value: string): Promise<void> {
  return invoke("set_config", { key, value });
}
