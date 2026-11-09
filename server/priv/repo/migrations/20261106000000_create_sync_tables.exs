defmodule Courtside.Repo.Migrations.CreateSyncTables do
  use Ecto.Migration

  # Every synced table carries organization_id (pull filters by it), version
  # (the organization's counter value from the push that last wrote the row) and
  # deleted (a tombstone, so pulls can report deletes). Ids come from the device.
  defp synced(table, fun) do
    create table(table, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :organization_id, references(:organizations, type: :binary_id), null: false
      fun.()
      add :version, :bigint, null: false
      add :deleted, :boolean, null: false, default: false
      timestamps(type: :utc_datetime)
    end

    create index(table, [:organization_id, :version])
  end

  def change do
    # A school. Not synced: phones get its id from configuration (later, sign-in).
    create table(:organizations, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :text, null: false
      timestamps(type: :utc_datetime)
    end

    # One row per organization holding its version counter. Every push bumps it
    # while holding the row lock, so pushes within an organization are
    # serialized and version order matches commit order (ADR 0001).
    #
    # data_id identifies this copy of the data. It changes whenever the
    # database is recreated or restored, and a phone that sees a new one pulls
    # from scratch instead of trusting its cursor.
    create table(:org_versions, primary_key: false) do
      add :organization_id, references(:organizations, type: :binary_id, on_delete: :delete_all),
        primary_key: true

      add :version, :bigint, null: false, default: 0
      add :data_id, :binary_id, null: false, default: fragment("gen_random_uuid()")
    end

    # Each device's sync identity and the last mutation the server processed for
    # it. A client id belongs to one organization.
    create table(:clients, primary_key: false) do
      add :id, :string, primary_key: true
      add :organization_id, references(:organizations, type: :binary_id), null: false
      add :last_mutation_id, :bigint, null: false, default: 0
      timestamps(type: :utc_datetime)
    end

    create table(:mutation_rejections, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :client_id, references(:clients, type: :string, on_delete: :delete_all), null: false
      add :mutation_id, :bigint, null: false
      add :name, :string, null: false
      add :args, :map, null: false
      add :reason, :text, null: false
      add :version, :bigint, null: false
      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:mutation_rejections, [:client_id, :mutation_id])

    synced(:programs, fn ->
      add :name, :text, null: false
      add :sport, :string, null: false
    end)

    create constraint(:programs, :sport_valid, check: "sport IN ('basketball')")

    # A school year, shared by the organization's programs. The server keeps an
    # organization's seasons from overlapping (pushes are serialized per
    # organization, so the check in the mutator can't race).
    synced(:seasons, fn ->
      add :name, :text, null: false
      add :starts_on, :date, null: false
      add :ends_on, :date, null: false
    end)

    create constraint(:seasons, :dates_ordered, check: "ends_on >= starts_on")

    synced(:teams, fn ->
      add :program_id, references(:programs, type: :binary_id), null: false
      add :name, :text, null: false
    end)

    synced(:players, fn ->
      add :program_id, references(:programs, type: :binary_id), null: false
      add :name, :text, null: false
    end)

    # A player's place on a team for a season, with the jersey worn there.
    synced(:roster_entries, fn ->
      add :team_id, references(:teams, type: :binary_id), null: false
      add :season_id, references(:seasons, type: :binary_id), null: false
      add :player_id, references(:players, type: :binary_id), null: false
      add :jersey, :string, null: false, default: ""
    end)

    create unique_index(:roster_entries, [:team_id, :season_id, :player_id],
             where: "NOT deleted",
             name: :roster_entries_once_per_team_season
           )

    synced(:drills, fn ->
      add :program_id, references(:programs, type: :binary_id), null: false
      add :name, :text, null: false
      add :kind, :string, null: false
      add :default_setup, :float
      add :archived, :boolean, null: false, default: false
    end)

    create constraint(:drills, :kind_valid, check: "kind IN ('makes', 'count', 'time')")

    create constraint(:drills, :default_setup_positive,
             check: "default_setup IS NULL OR default_setup > 0"
           )

    # Drill runs belong to the program; their season comes from their date.
    synced(:drill_runs, fn ->
      add :program_id, references(:programs, type: :binary_id), null: false
      add :date, :date, null: false
      add :drill_id, references(:drills, type: :binary_id), null: false
      add :setup, :float
    end)

    create constraint(:drill_runs, :setup_positive, check: "setup IS NULL OR setup > 0")

    # The server-side id is internal; clients address a result by (run, player).
    synced(:results, fn ->
      add :drill_run_id, references(:drill_runs, type: :binary_id), null: false
      add :player_id, references(:players, type: :binary_id), null: false
      add :value, :float
      add :setup, :float
    end)

    create unique_index(:results, [:drill_run_id, :player_id])
    create constraint(:results, :value_non_negative, check: "value IS NULL OR value >= 0")
    create constraint(:results, :setup_positive, check: "setup IS NULL OR setup > 0")
  end
end
