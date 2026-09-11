ALTER TABLE `room_players` ADD `vehicle_state` text DEFAULT 'dismounted' NOT NULL;--> statement-breakpoint
ALTER TABLE `room_players` ADD `switch_kind` text;--> statement-breakpoint
ALTER TABLE `room_players` ADD `last_exit_lat` real;--> statement-breakpoint
ALTER TABLE `room_players` ADD `last_exit_lng` real;--> statement-breakpoint
ALTER TABLE `room_players` ADD `last_exit_at` integer;--> statement-breakpoint
UPDATE `room_players`
SET `vehicle_state` = 'driving',
    `vehicle_started_at` = COALESCE(
      `vehicle_started_at`,
      (SELECT `started_at` FROM `rooms` WHERE `rooms`.`code` = `room_players`.`room_code`)
    )
WHERE `role` = 'runner' AND `left_at` IS NULL
  AND EXISTS (
    SELECT 1 FROM `rooms`
    WHERE `rooms`.`code` = `room_players`.`room_code` AND `rooms`.`status` = 'playing'
  );
