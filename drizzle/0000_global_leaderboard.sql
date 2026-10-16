CREATE TABLE `leaderboard` (
  `player_id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `score` integer NOT NULL,
  `kills` integer NOT NULL,
  `chips` integer NOT NULL,
  `survived` integer NOT NULL,
  `victory` integer NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `leaderboard_score_idx` ON `leaderboard` (`score` DESC, `created_at` ASC);
