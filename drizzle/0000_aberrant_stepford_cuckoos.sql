CREATE TABLE `room_players` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`token_hash` text NOT NULL,
	`nickname` text NOT NULL,
	`role` text NOT NULL,
	`ready` integer DEFAULT false NOT NULL,
	`caught` integer DEFAULT false NOT NULL,
	`joined_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`left_at` integer,
	`lat` real,
	`lng` real,
	`signal_lat` real,
	`signal_lng` real,
	`vehicle_started_at` integer,
	`switch_ends_at` integer,
	`vehicle_cycle` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_room_players_token_hash` ON `room_players` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_room_players_room_active` ON `room_players` (`room_code`,`left_at`);--> statement-breakpoint
CREATE INDEX `idx_room_players_room_role` ON `room_players` (`room_code`,`role`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_room_players_one_hunter` ON `room_players` (`room_code`) WHERE "room_players"."role" = 'hunter' AND "room_players"."left_at" IS NULL;--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`host_player_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`updated_at` integer NOT NULL,
	`signal_index` integer DEFAULT 0 NOT NULL,
	`capture_goal` integer DEFAULT 1 NOT NULL
);
