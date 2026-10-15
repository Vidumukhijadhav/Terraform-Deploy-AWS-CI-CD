terraform {
  backend "s3" {
    bucket = "s3-bucket-terrafrom-state"
    key    = "aws-state-bucket"
    region = "us-west-2"
    use_lockfile = true
  }
}
