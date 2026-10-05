CREATE TYPE "public"."coupon_status" AS ENUM('quarantined', 'verified');--> statement-breakpoint
CREATE TYPE "public"."report_outcome" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TABLE "coupon_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"outcome" "report_outcome" NOT NULL,
	"savings_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_reports_savings_valid" CHECK (("coupon_reports"."outcome" = 'success' AND "coupon_reports"."savings_cents" > 0) OR ("coupon_reports"."outcome" = 'failure' AND "coupon_reports"."savings_cents" = 0))
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" "coupon_status" DEFAULT 'quarantined' NOT NULL,
	"confirmations" integer DEFAULT 0 NOT NULL,
	"report_count" integer DEFAULT 0 NOT NULL,
	"expected_savings_cents" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_counts_valid" CHECK ("coupons"."confirmations" >= 0 AND "coupons"."report_count" >= "coupons"."confirmations"),
	CONSTRAINT "coupons_savings_nonnegative" CHECK ("coupons"."expected_savings_cents" >= 0),
	CONSTRAINT "coupons_verified_threshold" CHECK ("coupons"."status" = 'quarantined' OR "coupons"."confirmations" >= 3)
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_domain_unique" UNIQUE("domain"),
	CONSTRAINT "merchants_currency_usd" CHECK ("merchants"."currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_identity_hash_unique" UNIQUE("identity_hash"),
	CONSTRAINT "users_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "coupon_reports" ADD CONSTRAINT "coupon_reports_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_reports" ADD CONSTRAINT "coupon_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_reports_coupon_user_unique" ON "coupon_reports" USING btree ("coupon_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_merchant_code_unique" ON "coupons" USING btree ("merchant_id","code");--> statement-breakpoint
CREATE INDEX "coupons_candidates_idx" ON "coupons" USING btree ("merchant_id","status","expires_at");