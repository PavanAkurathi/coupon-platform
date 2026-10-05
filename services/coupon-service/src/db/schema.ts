import { sql } from 'drizzle-orm';
import { check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const couponStatus = pgEnum('coupon_status', ['quarantined', 'verified']);
export const reportOutcome = pgEnum('report_outcome', ['success', 'failure']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Hash of the beta operator's verified identity key; never a client-supplied user id.
  identityHash: text('identity_hash').notNull().unique(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const merchants = pgTable('merchants', {
  id: uuid('id').defaultRandom().primaryKey(),
  domain: text('domain').notNull().unique(),
  name: text('name').notNull(),
  currency: text('currency').default('USD').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [check('merchants_currency_usd', sql`${table.currency} = 'USD'`)]);

export const coupons = pgTable('coupons', {
  id: uuid('id').defaultRandom().primaryKey(),
  merchantId: uuid('merchant_id').notNull().references(() => merchants.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  status: couponStatus('status').default('quarantined').notNull(),
  confirmations: integer('confirmations').default(0).notNull(),
  reportCount: integer('report_count').default(0).notNull(),
  // Integer minor currency units. Rate and score are calculated, not rounded in storage.
  expectedSavingsCents: integer('expected_savings_cents').default(0).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('coupons_merchant_code_unique').on(table.merchantId, table.code),
  index('coupons_candidates_idx').on(table.merchantId, table.status, table.expiresAt),
  check('coupons_counts_valid', sql`${table.confirmations} >= 0 AND ${table.reportCount} >= ${table.confirmations}`),
  check('coupons_savings_nonnegative', sql`${table.expectedSavingsCents} >= 0`),
  check('coupons_verified_threshold', sql`${table.status} = 'quarantined' OR ${table.confirmations} >= 3`),
]);

export const couponReports = pgTable('coupon_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  couponId: uuid('coupon_id').notNull().references(() => coupons.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  outcome: reportOutcome('outcome').notNull(),
  savingsCents: integer('savings_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('coupon_reports_coupon_user_unique').on(table.couponId, table.userId),
  check('coupon_reports_savings_valid', sql`(${table.outcome} = 'success' AND ${table.savingsCents} > 0) OR (${table.outcome} = 'failure' AND ${table.savingsCents} = 0)`),
]);
