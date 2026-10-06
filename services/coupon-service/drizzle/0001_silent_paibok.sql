CREATE TYPE "public"."coupon_approval" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."coupon_attribution" AS ENUM('unknown', 'neutral', 'affiliate');--> statement-breakpoint
CREATE TYPE "public"."coupon_audience" AS ENUM('unknown', 'public', 'private', 'creator');--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "approval_status" "coupon_approval" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "audience" "coupon_audience" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "attribution_behavior" "coupon_attribution" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "evidence_ref" text;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_approval_evidence" CHECK ("coupons"."approval_status" <> 'approved' OR ("coupons"."reviewed_at" IS NOT NULL AND "coupons"."evidence_ref" IS NOT NULL AND length(trim("coupons"."evidence_ref")) > 0 AND "coupons"."reviewed_by" IS NOT NULL AND length(trim("coupons"."reviewed_by")) > 0));