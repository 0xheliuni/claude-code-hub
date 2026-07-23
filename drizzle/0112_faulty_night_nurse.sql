CREATE TYPE "public"."patrol_action" AS ENUM('none', 'circuit_open', 'disable', 'notify_only', 'recovered');--> statement-breakpoint
CREATE TYPE "public"."patrol_inspection_type" AS ENUM('quick_probe', 'deep_fingerprint');--> statement-breakpoint
CREATE TYPE "public"."patrol_verdict" AS ENUM('pass', 'warning', 'critical', 'counterfeit');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'patrol_alert';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "patrol_baselines" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_name" varchar(100) NOT NULL,
	"label" varchar(200),
	"provider_type" varchar(20) NOT NULL,
	"sample_count" integer NOT NULL,
	"distribution" jsonb NOT NULL,
	"stats" jsonb NOT NULL,
	"calibrated_at" timestamp with time zone DEFAULT now(),
	"calibrated_by" varchar(100),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "patrol_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer,
	"enabled" boolean,
	"quick_probe_enabled" boolean,
	"quick_probe_cron" varchar(100),
	"quick_probe_timeout_ms" integer,
	"quick_probe_probes" jsonb,
	"deep_fingerprint_enabled" boolean,
	"deep_fingerprint_cron" varchar(100),
	"deep_fingerprint_samples" integer,
	"deep_fingerprint_timeout_ms" integer,
	"threshold_pass" integer,
	"threshold_warning" integer,
	"threshold_critical" integer,
	"fingerprint_match_threshold" numeric(4, 3),
	"action_on_warning" varchar(20),
	"action_on_critical" varchar(20),
	"action_on_counterfeit" varchar(20),
	"auto_recover_enabled" boolean,
	"auto_recover_passes" integer,
	"auto_recover_counterfeit" boolean,
	"notify_on_warning" boolean,
	"notify_on_critical" boolean,
	"notify_on_counterfeit" boolean,
	"notify_on_recovery" boolean,
	"concurrency_limit" integer,
	"retry_attempts" integer,
	"cooldown_minutes" integer,
	"probe_weights" jsonb,
	"skip_patrol" boolean DEFAULT false NOT NULL,
	"expected_channel" varchar(20),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "patrol_provider_state" (
	"provider_id" integer PRIMARY KEY NOT NULL,
	"consecutive_pass_count" integer DEFAULT 0 NOT NULL,
	"last_verdict" "patrol_verdict",
	"last_score" integer,
	"last_inspected_at" timestamp with time zone,
	"patrol_disabled_reason" text,
	"patrol_disabled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "patrol_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"inspection_type" "patrol_inspection_type" NOT NULL,
	"score" integer NOT NULL,
	"verdict" "patrol_verdict" NOT NULL,
	"probe_details" jsonb NOT NULL,
	"fingerprint_details" jsonb,
	"action_taken" "patrol_action",
	"latency_ms" integer,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "patrol_configs" ADD CONSTRAINT "patrol_configs_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patrol_provider_state" ADD CONSTRAINT "patrol_provider_state_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patrol_results" ADD CONSTRAINT "patrol_results_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_patrol_baselines_model" ON "patrol_baselines" USING btree ("model_name","provider_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_patrol_configs_provider" ON "patrol_configs" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_patrol_results_provider_time" ON "patrol_results" USING btree ("provider_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_patrol_results_verdict" ON "patrol_results" USING btree ("verdict","created_at");