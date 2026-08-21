import type { JsonSchema } from '@openforge-app/plugin-sdk'

const literalSchema = (...values: unknown[]): JsonSchema => ({
  oneOf: values.map((value) => ({ const: value })),
})

const nullableSchema = (schema: JsonSchema): JsonSchema => ({
  oneOf: [schema, { const: null }],
})

const timingSchema: JsonSchema = {
  oneOf: [
    {
      type: 'object',
      required: ['type', 'at'],
      additionalProperties: false,
      properties: {
        type: { const: 'once' },
        at: { type: 'string', format: 'date-time' },
      },
    },
    {
      type: 'object',
      required: ['type', 'cron'],
      additionalProperties: false,
      properties: {
        type: { const: 'recurring' },
        cron: { type: 'string', minLength: 1 },
      },
    },
  ],
}

const modeSchema = literalSchema('create-and-start', 'create-only')

const fireOutcomeSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'firedAt', 'trigger', 'status', 'message'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    firedAt: { type: 'number' },
    trigger: literalSchema('scheduled', 'manual'),
    status: literalSchema('started', 'created', 'skipped', 'failed', 'cancelled'),
    taskId: { type: 'string' },
    message: { type: 'string' },
  },
}

export const taskScheduleOutputSchema: JsonSchema = {
  type: 'object',
  required: [
    'id',
    'title',
    'prompt',
    'kind',
    'preset',
    'cron',
    'runAt',
    'mode',
    'enabled',
    'createdAt',
    'updatedAt',
    'nextFireAt',
    'lastFireAt',
    'lastTaskId',
    'cancelledAt',
    'idempotencyKey',
    'history',
  ],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    prompt: { type: 'string' },
    kind: literalSchema('once', 'recurring'),
    preset: literalSchema('daily', 'weekly', 'monthly', 'custom', null),
    cron: nullableSchema({ type: 'string' }),
    runAt: nullableSchema({ type: 'number' }),
    mode: modeSchema,
    enabled: { type: 'boolean' },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    nextFireAt: nullableSchema({ type: 'number' }),
    lastFireAt: nullableSchema({ type: 'number' }),
    lastTaskId: nullableSchema({ type: 'string' }),
    cancelledAt: nullableSchema({ type: 'number' }),
    idempotencyKey: nullableSchema({ type: 'string' }),
    history: { type: 'array', items: fireOutcomeSchema },
  },
}

export const scheduleCommandInputSchema: JsonSchema = {
  type: 'object',
  required: ['title', 'prompt', 'timing'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1 },
    prompt: { type: 'string', minLength: 1 },
    timing: timingSchema,
    mode: modeSchema,
    idempotencyKey: { type: 'string', minLength: 1 },
  },
}


export const listSchedulesCommandOutputSchema: JsonSchema = {
  type: 'array',
  items: taskScheduleOutputSchema,
}

const updateScheduleProperties = {
  scheduleId: { type: 'string', minLength: 1 },
  title: { type: 'string', minLength: 1 },
  prompt: { type: 'string', minLength: 1 },
  timing: timingSchema,
  mode: modeSchema,
}

export const updateScheduleCommandInputSchema: JsonSchema = {
  anyOf: ['title', 'prompt', 'timing', 'mode'].map((changedField) => ({
    type: 'object',
    required: ['scheduleId', changedField],
    additionalProperties: false,
    properties: updateScheduleProperties,
  })),
}

export const cancelScheduleCommandInputSchema: JsonSchema = {
  type: 'object',
  required: ['scheduleId'],
  additionalProperties: false,
  properties: {
    scheduleId: { type: 'string', minLength: 1 },
  },
}
