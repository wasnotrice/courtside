defmodule Courtside.Repo.Migrations.CreateSyncTables do
  use Ecto.Migration

  def change do
    # One row holding the global version. Every push bumps it while holding the
    # row lock, which serializes pushes so version order matches commit order.
    create table(:server_meta, primary_key: false) do
      add :id, :integer, primary_key: true
      add :version, :bigint, null: false, default: 0
    end

    execute "INSERT INTO server_meta (id, version) VALUES (1, 0)", ""

    # Each device's sync identity and the last mutation the server processed for it.
    create table(:clients, primary_key: false) do
      add :id, :string, primary_key: true
      add :last_mutation_id, :bigint, null: false, default: 0
      timestamps(type: :utc_datetime)
    end

    create table(:mutation_rejections) do
      add :client_id, references(:clients, type: :string, on_delete: :delete_all), null: false
      add :mutation_id, :bigint, null: false
      add :name, :string, null: false
      add :args, :map, null: false
      add :reason, :text, null: false
      add :version, :bigint, null: false
      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:mutation_rejections, [:client_id, :mutation_id])

    # Synced tables: client-generated ids, a version for pull, a tombstone flag for deletes.
    create table(:players, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :text, null: false
      add :jersey, :string, null: false, default: ""
      add :active, :boolean, null: false, default: true
      add :version, :bigint, null: false
      add :deleted, :boolean, null: false, default: false
      timestamps(type: :utc_datetime)
    end

    create table(:drills, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :text, null: false
      add :kind, :string, null: false
      add :default_setup, :float
      add :archived, :boolean, null: false, default: false
      add :version, :bigint, null: false
      add :deleted, :boolean, null: false, default: false
      timestamps(type: :utc_datetime)
    end

    create constraint(:drills, :kind_valid, check: "kind IN ('makes', 'count', 'time')")
    create constraint(:drills, :default_setup_positive, check: "default_setup IS NULL OR default_setup > 0")

    create table(:drill_runs, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :date, :date, null: false
      add :drill_id, references(:drills, type: :binary_id), null: false
      add :setup, :float
      add :version, :bigint, null: false
      add :deleted, :boolean, null: false, default: false
      timestamps(type: :utc_datetime)
    end

    create constraint(:drill_runs, :setup_positive, check: "setup IS NULL OR setup > 0")

    create table(:results) do
      add :drill_run_id, references(:drill_runs, type: :binary_id), null: false
      add :player_id, references(:players, type: :binary_id), null: false
      add :value, :float
      add :setup, :float
      add :version, :bigint, null: false
      add :deleted, :boolean, null: false, default: false
      timestamps(type: :utc_datetime)
    end

    create unique_index(:results, [:drill_run_id, :player_id])
    create constraint(:results, :value_non_negative, check: "value IS NULL OR value >= 0")
    create constraint(:results, :setup_positive, check: "setup IS NULL OR setup > 0")

    for table <- [:players, :drills, :drill_runs, :results] do
      create index(table, [:version])
    end
  end
end
