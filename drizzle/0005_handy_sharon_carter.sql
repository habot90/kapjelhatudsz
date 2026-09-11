ALTER TABLE `room_players` ADD `civilian_lat` real;--> statement-breakpoint
ALTER TABLE `room_players` ADD `civilian_lng` real;--> statement-breakpoint
ALTER TABLE `room_players` ADD `civilian_accuracy` text;--> statement-breakpoint
ALTER TABLE `room_players` ADD `civilian_reported_at` integer;--> statement-breakpoint
ALTER TABLE `rooms` ADD `civilian_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `next_civilian_at` integer;
