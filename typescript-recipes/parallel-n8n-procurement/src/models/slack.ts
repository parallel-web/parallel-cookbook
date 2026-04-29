// Slack Block Kit types (outbound payloads — no Zod validation needed)

export type SlackBlock = Record<string, unknown>;

export interface SlackMessage {
  channel: string;
  text: string;
  blocks: SlackBlock[];
  thread_ts?: string;
}

export interface SlackRoute {
  message: SlackMessage;
  channel: string;
}
