ALTER TABLE `room_players` ADD `vehicle_state` text DEFAULT 'dismounted' NOT NULL;--> statement-breakpoint
ALTER TABLE `room_players` ADD `switch_kind` text;--> statement-breakpoint
ALTER TABLE `room_players` ADD `last_exit_lat` real;--> statement-breakpoint
ALTER TABLE `room_players` ADD `last_exit_lng` real;--> statement-breakpoint
ALTER TABLE `room_players` ADD `last_exit_at` integer;

