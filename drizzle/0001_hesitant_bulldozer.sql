ALTER TABLE `room_players` ADD `position_updated_at` integer;--> statement-breakpoint
ALTER TABLE `rooms` ADD `revision` integer DEFAULT 0 NOT NULL;