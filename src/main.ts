// src/main.ts
import { Devvit, SettingScope } from '@devvit/public-api';

const SETTINGS_GROUP = 'Strike System';

const S = {
  debug: 'strike_debug_logging',
  enabled: 'strike_enabled',
  strikeTags: 'strike_tags',
  threshold: 'strike_threshold',
  windowDays: 'strike_window_days',
  includeAutomod: 'strike_include_automod',
  requireRemovalReason: 'strike_require_removal_reason',
  notifyEveryTimeOverThreshold: 'strike_notify_every_time_over_threshold',
  addModNote: 'strike_add_mod_note',
  modNoteLabel: 'strike_mod_note_label',
  modNoteTemplate: 'strike_mod_note_template',
  modmailSubject: 'strike_modmail_subject',
  modmailBodyTemplate: 'strike_modmail_body_template',
  dedupeSameTargetWithinMinutes: 'strike_dedupe_minutes',
  applyTo: 'strike_apply_to', // posts/comments/both
} as const;

Devvit.addSettings([
  {
    type: 'boolean',
    name: S.debug,
    label: 'Debug logging',
    helpText: 'If ON, logs every step (recommended while testing).',
    scope: SettingScope.Installation,
    defaultValue: true,
    group: SETTINGS_GROUP,
  },
  {
    type: 'boolean',
    name: S.enabled,
    label: 'Enabled',
    helpText: 'Master toggle for the strike system.',
    scope: SettingScope.Installation,
    defaultValue: true,
    group: SETTINGS_GROUP,
  },
  {
    type: 'string',
    name: S.strikeTags,
    label: 'Strike tags / keywords (comma or newline separated)',
    helpText:
      'A removal counts as a strike only if the removal reason/modlog text contains ANY of these keywords (case-insensitive). Examples: "#strike", "3 strike rule".',
    scope: SettingScope.Installation,
    defaultValue: '#strike,3 strike',
    group: SETTINGS_GROUP,
  },
  {
    type: 'number',
    name: S.threshold,
    label: 'Strike threshold',
    helpText: 'How many strikes within the time window triggers escalation.',
    scope: SettingScope.Installation,
    defaultValue: 3,
    group: SETTINGS_GROUP,
  },
  {
    type: 'number',
    name: S.windowDays,
    label: 'Time window (days)',
    helpText: 'Only strikes within the last N days are counted.',
    scope: SettingScope.Installation,
    defaultValue: 14,
    group: SETTINGS_GROUP,
  },
  {
    type: 'string',
    name: S.applyTo,
    label: 'Apply strikes to',
    helpText: 'Count removals for posts, comments, or both.',
    scope: SettingScope.Installation,
    defaultValue: 'both',
    group: SETTINGS_GROUP,
  },
  {
    type: 'boolean',
    name: S.includeAutomod,
    label: 'Count AutoModerator removals',
    helpText: 'If OFF, removals performed by AutoModerator will not add strikes.',
    scope: SettingScope.Installation,
    defaultValue: false,
    group: SETTINGS_GROUP,
  },
  {
    type: 'boolean',
    name: S.requireRemovalReason,
    label: 'Require Removal Reason to count strike',
    helpText:
      'If ON, the bot will only count strikes when it can verify the removal reason via the addremovalreason modlog entry.',
    scope: SettingScope.Installation,
    defaultValue: true,
    group: SETTINGS_GROUP,
  },
  {
    type: 'number',
    name: S.dedupeSameTargetWithinMinutes,
    label: 'Deduplicate same target (minutes)',
    helpText:
      'Prevents double-counting the same post/comment being processed repeatedly within this many minutes. Set 0 to disable.',
    scope: SettingScope.Installation,
    defaultValue: 10,
    group: SETTINGS_GROUP,
  },
  {
    type: 'boolean',
    name: S.notifyEveryTimeOverThreshold,
    label: 'Notify on every violation after threshold',
    helpText:
      'If ON: once at/over threshold, every additional strike triggers modmail+note. If OFF: only when crossing threshold.',
    scope: SettingScope.Installation,
    defaultValue: true,
    group: SETTINGS_GROUP,
  },
  {
    type: 'boolean',
    name: S.addModNote,
    label: 'Add Mod Note',
    helpText: 'Adds a mod note when threshold is met/exceeded.',
    scope: SettingScope.Installation,
    defaultValue: true,
    group: SETTINGS_GROUP,
  },
  {
    type: 'string',
    name: S.modNoteLabel,
    label: 'Mod Note label',
    helpText: 'Keep configurable.',
    scope: SettingScope.Installation,
    defaultValue: 'Abuse Warning',
    group: SETTINGS_GROUP,
  },
  {
    type: 'string',
    name: S.modNoteTemplate,
    label: 'Mod Note text template',
    helpText:
      'Vars: {username}, {count}, {threshold}, {windowDays}, {kind}, {targetId}, {subreddit}, {matchedTagText}.',
    scope: SettingScope.Installation,
    defaultValue:
      'StrikeBot: u/{username} at {count}/{threshold} strikes in {windowDays}d. Latest: {kind} {targetId}. Tags: {matchedTagText}',
    group: SETTINGS_GROUP,
  },
  {
    type: 'string',
    name: S.modmailSubject,
    label: 'Modmail subject',
    helpText: 'Vars: {username}, {count}, {threshold}, {windowDays}, {subreddit}.',
    scope: SettingScope.Installation,
    defaultValue: 'Strike alert: u/{username} ({count}/{threshold} in {windowDays}d)',
    group: SETTINGS_GROUP,
  },
  {
    type: 'string',
    name: S.modmailBodyTemplate,
    label: 'Modmail body template (Markdown)',
    helpText:
      'Vars: {username}, {count}, {threshold}, {windowDays}, {kind}, {targetId}, {subreddit}, {matchedTagText}, {modActionText}.',
    scope: SettingScope.Installation,
    defaultValue:
      [
        'User: u/{username}',
        '',
        '**Strike status:** {count}/{threshold} strikes in the last {windowDays} days',
        '',
        '**Latest removal:** {kind} `{targetId}`',
        '',
        '**Matched tags:** {matchedTagText}',
        '',
        '**Moderation log text:**',
        '> {modActionText}',
      ].join('\n'),
    group: SETTINGS_GROUP,
  },
]);

Devvit.configure({
  redditAPI: true,
  redis: true,
});

type StrikeEventKind = 'post' | 'comment';

type StrikeRecord = {
  t: number; // epoch ms
  kind: StrikeEventKind;
  targetId: string; // t3_ / t1_
};

function nowMs(): number {
  return Date.now();
}

function safeStringify(obj: unknown): string {
  try {
    const seen = new WeakSet();
    return JSON.stringify(
      obj,
      (_k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v as object)) return '[Circular]';
          seen.add(v as object);
        }
        if (typeof v === 'string' && v.length > 2500) return v.slice(0, 2500) + '…(truncated)';
        return v;
      },
      2
    );
  } catch (e) {
    return `<<unstringifiable: ${String(e)}>>`;
  }
}

function parseTags(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) => (k in vars ? vars[k] : `{${k}}`));
}

function log(context: any, debug: boolean, msg: string, data?: unknown) {
  if (!debug) return;
  const line = data === undefined ? msg : `${msg}\n${safeStringify(data)}`;
  // eslint-disable-next-line no-console
  console.log(line);
  try {
    context?.log?.info?.(line);
  } catch {
    // ignore
  }
}

function redisKeyStrikes(subredditId: string, userId: string): string {
  return `strike:v3:${subredditId}:user:${userId}:records`;
}

function redisKeyLastCounted(subredditId: string, targetId: string): string {
  return `strike:v3:${subredditId}:target:${targetId}:lastCountedAt`;
}

async function getConfig(context: any) {
  return {
    debug: Boolean(await context.settings.get(S.debug)),
    enabled: Boolean(await context.settings.get(S.enabled)),
    strikeTags: parseTags((await context.settings.get(S.strikeTags)) as string),
    threshold: Number((await context.settings.get(S.threshold)) ?? 3),
    windowDays: Number((await context.settings.get(S.windowDays)) ?? 14),
    includeAutomod: Boolean(await context.settings.get(S.includeAutomod)),
    requireRemovalReason: Boolean(await context.settings.get(S.requireRemovalReason)),
    notifyEveryTimeOverThreshold: Boolean(await context.settings.get(S.notifyEveryTimeOverThreshold)),
    addModNote: Boolean(await context.settings.get(S.addModNote)),
    modNoteLabel: ((await context.settings.get(S.modNoteLabel)) as string) ?? 'Abuse Warning',
    modNoteTemplate:
      ((await context.settings.get(S.modNoteTemplate)) as string) ??
      'StrikeBot: u/{username} at {count}/{threshold} strikes in {windowDays}d.',
    modmailSubject:
      ((await context.settings.get(S.modmailSubject)) as string) ??
      'Strike alert: u/{username} ({count}/{threshold} in {windowDays}d)',
    modmailBodyTemplate:
      ((await context.settings.get(S.modmailBodyTemplate)) as string) ??
      'User: u/{username}\n\nStrike status: {count}/{threshold} in {windowDays}d',
    dedupeMinutes: Number((await context.settings.get(S.dedupeSameTargetWithinMinutes)) ?? 10),
    applyTo: String((await context.settings.get(S.applyTo)) ?? 'both').toLowerCase(),
  };
}

function pruneToWindow(records: StrikeRecord[], windowDays: number): StrikeRecord[] {
  const cutoff = nowMs() - windowDays * 24 * 60 * 60 * 1000;
  return records.filter((r) => typeof r?.t === 'number' && r.t >= cutoff);
}

function matchAnyTag(haystack: string, tags: string[]): string[] {
  const text = (haystack || '').toLowerCase();
  return tags.filter((t) => t && text.includes(t));
}

async function shouldDedupe(context: any, subredditId: string, targetId: string, dedupeMinutes: number): Promise<boolean> {
  if (!dedupeMinutes || dedupeMinutes <= 0) return false;
  const key = redisKeyLastCounted(subredditId, targetId);
  const raw = (await context.redis.get(key)) as string | undefined | null;
  const last = raw ? Number(raw) : 0;
  const delta = nowMs() - last;
  if (last && delta < dedupeMinutes * 60 * 1000) return true;
  await context.redis.set(key, String(nowMs()));
  return false;
}

async function loadStrikeRecords(context: any, subredditId: string, userId: string): Promise<StrikeRecord[]> {
  const key = redisKeyStrikes(subredditId, userId);
  const raw = (await context.redis.get(key)) as string | undefined | null;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StrikeRecord[]) : [];
  } catch {
    return [];
  }
}

async function saveStrikeRecords(context: any, subredditId: string, userId: string, records: StrikeRecord[]) {
  const key = redisKeyStrikes(subredditId, userId);
  await context.redis.set(key, JSON.stringify(records));
}

async function getSubredditName(context: any): Promise<string> {
  try {
    const sr = await context.reddit.getCurrentSubreddit();
    if (sr?.name) return sr.name;
  } catch {
    // ignore
  }
  return String(context.subredditName ?? 'unknown-subreddit');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * ✅ Works with your actual modlog entry shape:
 * - `type` (not `action`)
 * - `target.id` (not targetFullname)
 * - `description` + `details` are where your reason fields are
 */
async function findAddRemovalReasonLogText(
  context: any,
  subredditName: string,
  targetId: string,
  debug: boolean
): Promise<string> {
  const listingToItems = async (listingLike: any): Promise<any[]> => {
    if (!listingLike) return [];
    if (typeof listingLike?.all === 'function') {
      try {
        const all = await listingLike.all();
        if (Array.isArray(all)) return all;
      } catch (e) {
        log(context, debug, `[MODLOG] listing.all() failed`, { error: String(e) });
      }
    }
    if (Array.isArray(listingLike)) return listingLike;
    if (Array.isArray(listingLike?.children)) return listingLike.children;
    if (Array.isArray(listingLike?.data?.children)) return listingLike.data.children;
    return [];
  };

  const fetchOnce = async (useTypeFilter: boolean): Promise<any[]> => {
    try {
      const params: any = { subredditName, limit: 250 };
      if (useTypeFilter) params.type = 'addremovalreason';
      const listing = await context.reddit.getModerationLog(params);
      const items = await listingToItems(listing);
      log(context, debug, `[MODLOG] getModerationLog returned`, {
        useTypeFilter,
        hasAll: typeof listing?.all === 'function',
        isArray: Array.isArray(items),
        length: items?.length,
      });
      return items;
    } catch (e) {
      log(context, debug, `[MODLOG] ERROR getModerationLog`, { useTypeFilter, error: String(e) });
      return [];
    }
  };

  const buildCombined = (it: any): string => {
    const action = String(it?.action ?? it?.type ?? '').toLowerCase();
    const desc = String(it?.description ?? '');
    const details = String(it?.details ?? '');
    const modName = String(it?.moderatorName ?? it?.mod ?? '');
    const target = it?.target ?? {};
    const tid = String(target?.id ?? '');
    const ttitle = String(target?.title ?? '');
    const tbody = String(target?.body ?? '');
    const tpermalink = String(target?.permalink ?? '');
    return [
      `action=${action}`,
      `target=${tid}`,
      `moderator=${modName}`,
      `description=${desc}`,
      `details=${details}`,
      `title=${ttitle}`,
      `body=${tbody}`,
      `permalink=${tpermalink}`,
    ]
      .filter(Boolean)
      .join(' | ')
      .trim();
  };

  const tryResolve = (items: any[]): string => {
    if (!Array.isArray(items) || items.length === 0) return '';

    const idShort = targetId.replace(/^t[13]_/, '');

    for (const it of items) {
      const action = String(it?.action ?? it?.type ?? '').toLowerCase();
      const isAddReason = action === 'addremovalreason';

      const logTargetId = String(it?.target?.id ?? it?.targetId ?? it?.targetFullname ?? '');
      const matchesTarget =
        logTargetId === targetId ||
        logTargetId === idShort ||
        (logTargetId && (logTargetId.includes(targetId) || logTargetId.includes(idShort)));

      if (isAddReason && matchesTarget) {
        log(context, debug, `[MODLOG] matched addremovalreason entry`, it);
        return buildCombined(it);
      }
    }

    log(context, debug, `[MODLOG] no addremovalreason match for target ${targetId}. Sample entries:`, items.slice(0, 3));
    return '';
  };

  // Try typed -> untyped -> delay -> retry (eventual consistency)
  let items = await fetchOnce(true);
  let resolved = tryResolve(items);
  if (resolved) return resolved;

  items = await fetchOnce(false);
  resolved = tryResolve(items);
  if (resolved) return resolved;

  await sleep(900);

  items = await fetchOnce(true);
  resolved = tryResolve(items);
  if (resolved) return resolved;

  items = await fetchOnce(false);
  resolved = tryResolve(items);
  if (resolved) return resolved;

  return '';
}

async function maybeNotifyAndNote(args: {
  context: any;
  debug: boolean;
  subredditId: string;
  subredditName: string;
  userId: string;
  username: string;
  count: number;
  threshold: number;
  windowDays: number;
  kind: StrikeEventKind;
  targetId: string;
  matchedTags: string[];
  modActionText: string;
  notifyEveryTimeOverThreshold: boolean;
  addModNote: boolean;
  modNoteLabel: string;
  modNoteTemplate: string;
  modmailSubject: string;
  modmailBodyTemplate: string;
}) {
  const {
    context,
    debug,
    subredditId,
    subredditName,
    userId,
    username,
    count,
    threshold,
    windowDays,
    kind,
    targetId,
    matchedTags,
    modActionText,
    notifyEveryTimeOverThreshold,
    addModNote,
    modNoteLabel,
    modNoteTemplate,
    modmailSubject,
    modmailBodyTemplate,
  } = args;

  if (count < threshold) {
    log(context, debug, `[ESCALATE] no: ${count} < ${threshold}`);
    return;
  }
  if (!notifyEveryTimeOverThreshold && count !== threshold) {
    log(context, debug, `[ESCALATE] no: notifyEveryTimeOverThreshold=OFF and count=${count} not equal threshold`);
    return;
  }

  const vars: Record<string, string> = {
    username,
    count: String(count),
    threshold: String(threshold),
    windowDays: String(windowDays),
    kind,
    targetId,
    subreddit: subredditName,
    matchedTagText: matchedTags.join(', ') || '(none)',
    modActionText: (modActionText || '(empty)').replace(/\n/g, ' '),
  };

  const subject = fillTemplate(modmailSubject, vars);
  const bodyMarkdown = fillTemplate(modmailBodyTemplate, vars);

  try {
    log(context, debug, `[MODMAIL] sending`, { subject });
    await context.reddit.modMail.createModNotification({ subredditId, subject, bodyMarkdown });
    log(context, debug, `[MODMAIL] sent OK`);
  } catch (e) {
    log(context, debug, `[MODMAIL] ERROR`, { error: String(e) });
  }

  if (addModNote) {
    try {
      const note = fillTemplate(modNoteTemplate, vars);
      log(context, debug, `[MODNOTE] adding`, { label: modNoteLabel, note });
      await context.reddit.addModNote({ subredditId, userId, note, label: modNoteLabel });
      log(context, debug, `[MODNOTE] added OK`);
    } catch (e) {
      log(context, debug, `[MODNOTE] ERROR`, { error: String(e) });
    }
  }
}

Devvit.addTrigger({
  event: 'ModAction',
  async onEvent(event, context) {
    const cfg = await getConfig(context);

    log(context, cfg.debug, `\n========================`);
    log(context, cfg.debug, `[EVENT] ModAction at ${new Date().toISOString()}`);
    log(context, cfg.debug, `[EVENT] raw`, event);

    if (!cfg.enabled) {
      log(context, cfg.debug, `[SKIP] disabled`);
      return;
    }

    const action = String((event as any)?.action ?? '').toLowerCase();
    const subredditId = context.subredditId;
    const subredditName = await getSubredditName(context);

    const moderatorName = String((event as any)?.moderator?.name ?? '').toLowerCase();
    if (!cfg.includeAutomod && moderatorName === 'automoderator') {
      log(context, cfg.debug, `[SKIP] automod removal and includeAutomod=OFF`);
      return;
    }

    const targetId = (event as any)?.targetPost?.id || (event as any)?.targetComment?.id || (event as any)?.targetId;

    if (!targetId || typeof targetId !== 'string') {
      log(context, cfg.debug, `[SKIP] no targetId`);
      return;
    }

    const kindFromId: StrikeEventKind = targetId.startsWith('t3_') ? 'post' : 'comment';

    if (cfg.applyTo === 'posts' && kindFromId !== 'post') {
      log(context, cfg.debug, `[SKIP] applyTo=posts, target is comment`, { targetId });
      return;
    }
    if (cfg.applyTo === 'comments' && kindFromId !== 'comment') {
      log(context, cfg.debug, `[SKIP] applyTo=comments, target is post`, { targetId });
      return;
    }

    if (action !== 'addremovalreason') {
      log(context, cfg.debug, `[INFO] not addremovalreason (no strike count on this action)`, { action, targetId });
      return;
    }

    if (await shouldDedupe(context, subredditId, targetId, cfg.dedupeMinutes)) {
      log(context, cfg.debug, `[SKIP] dedupe hit`, { targetId });
      return;
    }

    const targetUser = (event as any)?.targetUser;
    const authorId = String(targetUser?.id ?? '');
    const authorName = String(targetUser?.name ?? '');
    if (!authorId || !authorName) {
      log(context, cfg.debug, `[SKIP] missing targetUser id/name on addremovalreason`, { targetUser });
      return;
    }

    const modActionText = await findAddRemovalReasonLogText(context, subredditName, targetId, cfg.debug);

    if (cfg.requireRemovalReason && !modActionText) {
      log(context, cfg.debug, `[SKIP] requireRemovalReason=ON but could not resolve modlog text`);
      return;
    }

    log(context, cfg.debug, `[INFO] modActionText`, { modActionText });

    const matchedTags = matchAnyTag(modActionText, cfg.strikeTags);
    if (matchedTags.length === 0) {
      log(context, cfg.debug, `[SKIP] no strike tags matched`, { strikeTags: cfg.strikeTags });
      return;
    }

    log(context, cfg.debug, `[MATCH] tags`, { matchedTags });

    const existing = await loadStrikeRecords(context, subredditId, authorId);
    log(context, cfg.debug, `[STORE] existing strikes`, { count: existing.length });

    const pruned = pruneToWindow(existing, cfg.windowDays);
    if (pruned.length !== existing.length) {
      log(context, cfg.debug, `[STORE] pruned`, { before: existing.length, after: pruned.length });
    }

    const newRecord: StrikeRecord = { t: nowMs(), kind: kindFromId, targetId };
    pruned.push(newRecord);

    await saveStrikeRecords(context, subredditId, authorId, pruned);
    log(context, cfg.debug, `[STORE] saved`, { newCount: pruned.length, added: newRecord });

    await maybeNotifyAndNote({
      context,
      debug: cfg.debug,
      subredditId,
      subredditName,
      userId: authorId,
      username: authorName,
      count: pruned.length,
      threshold: cfg.threshold,
      windowDays: cfg.windowDays,
      kind: kindFromId,
      targetId,
      matchedTags,
      modActionText,
      notifyEveryTimeOverThreshold: cfg.notifyEveryTimeOverThreshold,
      addModNote: cfg.addModNote,
      modNoteLabel: cfg.modNoteLabel,
      modNoteTemplate: cfg.modNoteTemplate,
      modmailSubject: cfg.modmailSubject,
      modmailBodyTemplate: cfg.modmailBodyTemplate,
    });

    log(context, cfg.debug, `[DONE] processed addremovalreason`, { targetId, authorName });
  },
});

export default Devvit;
