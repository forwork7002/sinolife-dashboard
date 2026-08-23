/**
 * Structured logging.
 *
 * Server-only. Every log line is JSON in production so it can be queried, and
 * pretty-printed in development so it can be read.
 *
 * REDACTION IS NOT OPTIONAL
 * The Bitrix24 webhook URL embeds an access token in its path, and the database
 * URL embeds a password. Both routinely end up inside error objects. The redact
 * list below is the last line of defence before either reaches a log file.
 */

import pino, { type Logger } from 'pino'

import { env } from '@/server/config/env'

const isProduction = env.NODE_ENV === 'production'

export const logger: Logger = pino({
  level: env.LOG_LEVEL,

  redact: {
    paths: [
      'password',
      '*.password',
      'passwordHash',
      '*.passwordHash',
      'token',
      '*.token',
      'accessToken',
      '*.accessToken',
      'refreshToken',
      '*.refreshToken',
      'authorization',
      '*.authorization',
      'headers.authorization',
      'headers.cookie',
      'webhookUrl',
      '*.webhookUrl',
      'BITRIX24_WEBHOOK_URL',
      'DATABASE_URL',
      'BETTER_AUTH_SECRET',
    ],
    censor: '[redacted]',
  },

  // Pretty output locally; newline-delimited JSON everywhere else.
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },

  base: { service: 'sinolife-dashboard' },
})

/** A child logger tagged with a subsystem name. */
export function childLogger(component: string, context: Record<string, unknown> = {}): Logger {
  return logger.child({ component, ...context })
}

/**
 * Correlation id for one request.
 *
 * Errors returned to the client carry this id but never the underlying
 * message, so support can find the real cause in the logs without the browser
 * ever seeing a stack trace.
 */
export function newCorrelationId(): string {
  return crypto.randomUUID()
}
