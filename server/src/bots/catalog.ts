import { createAutomod } from './modules/automod.ts';
import { reminders } from './modules/reminders.ts';
import { welcome } from './modules/welcome.ts';
import { highlights } from './modules/highlights.ts';
import type { BotModule } from './types.ts';

/** Bots oficiais do ShareRoom. Por enquanto a biblioteca só tem estes; bots de terceiros não rodam aqui. */
export const officialBots = (): BotModule[] => [createAutomod(), welcome, reminders, highlights];
