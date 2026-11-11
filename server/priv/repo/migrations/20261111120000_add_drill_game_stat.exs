defmodule Courtside.Repo.Migrations.AddDrillGameStat do
  use Ecto.Migration

  # A makes drill can name the game stat it practices (free throws, 2s or 3s), so
  # practice can be compared with games (docs/games-plan.md, "Season totals").
  def change do
    alter table(:drills) do
      add :game_stat, :string
    end

    create constraint(:drills, :game_stat_valid,
             check: "game_stat IS NULL OR (game_stat IN ('ft', 'fg2', 'fg3') AND kind = 'makes')"
           )
  end
end
