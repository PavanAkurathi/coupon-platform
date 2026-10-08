ALTER TABLE "merchants" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "status_note" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "status_changed_by" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_domain_hostname" CHECK ("merchants"."domain" ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' AND "merchants"."domain" = lower("merchants"."domain"));--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_disable_reason" CHECK ("merchants"."enabled" OR ("merchants"."status_note" IS NOT NULL AND length(trim("merchants"."status_note")) > 0 AND "merchants"."status_changed_by" IS NOT NULL));