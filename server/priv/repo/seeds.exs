# Seeds the dev database with one organization, one program and one team.
# The phone app uses these fixed ids until sign-in exists.
#
#     mix run priv/repo/seeds.exs
#
# Running it again does nothing.

alias Courtside.{Organizations, Repo, Sync}
alias Courtside.Schema.Organization

org = "c0000000-0000-4000-8000-000000000001"
program = "c0000000-0000-4000-8000-000000000002"
team = "c0000000-0000-4000-8000-000000000003"

unless Repo.get(Organization, org) do
  Organizations.create!("Courtside High", org)

  # Through push, so the rows get versions like any other change.
  {:ok, %{rejections: []}} =
    Sync.push(org, "seed", [
      %{
        "id" => 1,
        "name" => "program.put",
        "args" => %{"id" => program, "name" => "Girls' basketball", "sport" => "basketball"}
      },
      %{
        "id" => 2,
        "name" => "team.put",
        "args" => %{"id" => team, "program_id" => program, "name" => "Varsity"}
      }
    ])
end
