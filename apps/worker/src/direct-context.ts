import type { DiscordImageReference } from "./image-context.js";
import type { YapImageContext } from "./response-generator.js";

export const DEFAULT_DIRECT_CONTEXT_MINUTES = 180;
export const DIRECT_CONTEXT_MESSAGES = 40;
export const DIRECT_CONTEXT_CHARACTERS = 20_000;

export interface Participant {
  id: string;
  username: string;
  displayName: string;
  globalName?: string;
  bot: boolean;
}

export interface DirectMessage {
  id: string;
  guildId: string;
  channelId: string;
  author: Participant;
  content: string;
  createdAtMs: number;
  ignored: boolean;
  mentions: Participant[];
  replyToId?: string;
  images: readonly DiscordImageReference[];
  declaredImageCount: number;
}

export interface SubjectResolution {
  method: "mention" | "plain_name" | "reply" | "none" | "ambiguous";
  subjects: Participant[];
  ambiguousNames: string[];
}

export interface DirectContext {
  request: DirectMessage;
  recentConversation: DirectMessage[];
  repliedTo?: DirectMessage;
  subjectResolution: SubjectResolution;
  subjectPersonas: { userId: string; description: string }[];
  contextLimitations: string[];
  images: readonly YapImageContext[];
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\u2019/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

const commonNames = new Set([
  "a",
  "an",
  "the",
  "you",
  "me",
  "i",
  "it",
  "this",
  "that",
  "here",
  "what",
  "who",
  "will",
  "may",
  "can",
  "no",
  "yes",
  "bot",
  "yapbot",
]);

export function resolveSubjects(
  request: DirectMessage,
  evidence: readonly DirectMessage[],
  botId: string,
  reply?: DirectMessage,
): SubjectResolution {
  const mentions = [
    ...new Map(
      request.mentions
        .filter((p) => !p.bot && p.id !== botId)
        .map((p) => [p.id, p]),
    ).values(),
  ];
  if (mentions.length)
    return { method: "mention", subjects: mentions, ambiguousNames: [] };
  const participants = new Map<string, Participant>();
  for (const message of [...evidence, ...(reply ? [reply] : []), request]) {
    if (!message.author.bot && message.author.id !== botId)
      participants.set(message.author.id, message.author);
  }
  const aliases = new Map<string, Map<string, Participant>>();
  for (const person of participants.values()) {
    for (const value of [
      person.username,
      person.displayName,
      person.globalName ?? "",
    ]) {
      const alias = normalized(value);
      if (alias.length < 2 || commonNames.has(alias)) continue;
      const matches = aliases.get(alias) ?? new Map<string, Participant>();
      matches.set(person.id, person);
      aliases.set(alias, matches);
    }
  }
  let question = normalized(request.content).replace(/<@!?\d+>/gu, " ");
  const subjects = new Map<string, Participant>();
  const ambiguousNames: string[] = [];
  for (const [alias, people] of [...aliases].sort(
    ([a], [b]) => b.length - a.length,
  )) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escaped}(?:'s|s)?(?![\\p{L}\\p{N}_])`,
      "gu",
    );
    if (!pattern.test(question)) continue;
    if (people.size > 1) ambiguousNames.push(alias);
    else for (const person of people.values()) subjects.set(person.id, person);
    // Do not resolve a shorter nickname inside a longer matching display name.
    question = question.replace(pattern, " ");
  }
  if (ambiguousNames.length)
    return { method: "ambiguous", subjects: [], ambiguousNames };
  if (subjects.size)
    return {
      method: "plain_name",
      subjects: [...subjects.values()],
      ambiguousNames: [],
    };
  if (reply && !reply.author.bot && reply.author.id !== botId)
    return { method: "reply", subjects: [reply.author], ambiguousNames: [] };
  return { method: "none", subjects: [], ambiguousNames: [] };
}

export function buildDirectContext(
  request: DirectMessage,
  history: readonly DirectMessage[],
  botId: string,
  reply?: DirectMessage,
  limitations: string[] = [],
  contextMinutes = DEFAULT_DIRECT_CONTEXT_MINUTES,
): DirectContext {
  if (
    !Number.isInteger(contextMinutes) ||
    contextMinutes < 1 ||
    contextMinutes > 1440
  ) {
    throw new Error("Direct context minutes must be an integer from 1 to 1440");
  }
  const sameScope = (message: DirectMessage) =>
    message.guildId === request.guildId &&
    message.channelId === request.channelId &&
    message.createdAtMs <= request.createdAtMs &&
    message.id !== request.id;
  const usableReply =
    reply &&
    sameScope(reply) &&
    !reply.ignored &&
    (!reply.author.bot || reply.author.id === botId)
      ? reply
      : undefined;
  const windowStart = request.createdAtMs - contextMinutes * 60_000;
  const candidates = [
    ...new Map(
      history
        .filter(
          (m) =>
            sameScope(m) &&
            !m.ignored &&
            !m.author.bot &&
            m.createdAtMs >= windowStart &&
            m.id !== usableReply?.id,
        )
        .map((m) => [m.id, m]),
    ).values(),
  ];
  const resolution = resolveSubjects(request, candidates, botId, usableReply);
  const subjects = new Set(resolution.subjects.map((p) => p.id));
  const bounded = (message: DirectMessage): DirectMessage => ({
    ...message,
    content: message.content.slice(0, 2_000),
  });
  const boundedRequest = bounded(request);
  const boundedReply = usableReply ? bounded(usableReply) : undefined;
  let remaining =
    DIRECT_CONTEXT_CHARACTERS -
    boundedRequest.content.length -
    (boundedReply?.content.length ?? 0);
  // Ensure a named subject's recent evidence survives a busy channel, then fill
  // with surrounding messages. Send the chosen messages in chronological order.
  candidates.sort((a, b) => b.createdAtMs - a.createdAtMs);
  const preferred = candidates
    .filter((m) => subjects.has(m.author.id))
    .slice(0, 8);
  const ordered = [
    ...new Map([...preferred, ...candidates].map((m) => [m.id, m])).values(),
  ];
  const selected: DirectMessage[] = [];
  for (const message of ordered) {
    if (selected.length >= DIRECT_CONTEXT_MESSAGES || remaining <= 0) break;
    const value = bounded(message);
    value.content = value.content.slice(0, remaining);
    remaining -= value.content.length;
    selected.push(value);
  }
  const contextLimitations = [...limitations];
  if (selected.length < candidates.length)
    contextLimitations.push(
      "History was trimmed to the configured context bounds.",
    );
  if (boundedReply && boundedReply.createdAtMs < windowStart)
    contextLimitations.push(
      "The explicitly replied-to message is older than the recent conversation window.",
    );
  if (selected.length === 0 && !boundedReply)
    contextLimitations.push(
      `No channel conversation is available within the preceding ${contextMinutes} minutes. This is missing evidence, not proof that nobody said anything. Answer a self-contained request; otherwise ask for the relevant comment or a reply to it.`,
    );
  return {
    request: boundedRequest,
    recentConversation: selected.sort((a, b) => a.createdAtMs - b.createdAtMs),
    ...(boundedReply ? { repliedTo: boundedReply } : {}),
    subjectResolution: resolution,
    subjectPersonas: [],
    contextLimitations,
    images: [],
  };
}

export function directMediaCandidates(context: DirectContext): DirectMessage[] {
  const subjects = new Set(context.subjectResolution.subjects.map((p) => p.id));
  const history = [...context.recentConversation].reverse();
  return [
    ...new Map(
      [
        context.request,
        ...(context.repliedTo ? [context.repliedTo] : []),
        ...history.filter((m) => subjects.has(m.author.id)),
        ...history,
      ]
        .filter((m) => m.images.length > 0 || /https?:\/\//iu.test(m.content))
        .map((m) => [m.id, m]),
    ).values(),
  ].slice(0, 3);
}
