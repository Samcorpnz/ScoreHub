terraform {
  required_version = ">= 1.5"

  # State lives in HCP Terraform (app.terraform.io) so the `infra-betterstack`
  # workflow can plan and apply — it used to be a local, gitignored file on
  # one laptop. HCP is used for state storage and locking only: the workspace
  # must be set to the "Local" execution mode, so plans and applies run in
  # GitHub Actions (or on your machine) with the secrets held there. The
  # organization comes from TF_CLOUD_ORGANIZATION and the API token from
  # TF_TOKEN_app_terraform_io (or `terraform login`), never from this file.
  cloud {
    workspaces {
      name = "scorehub-betterstack"
    }
  }

  required_providers {
    betteruptime = {
      source  = "BetterStackHQ/better-uptime"
      version = "~> 0.21"
    }
  }
}

# Auth via BETTERUPTIME_API_TOKEN env var (Better Stack dashboard ->
# Settings -> API tokens) rather than a provider block argument, so the
# token never lands in state or a .tf file.
provider "betteruptime" {}
