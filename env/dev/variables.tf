variable "vpc_name" {
  description = "Name of the VPC"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
}

variable "az_1" {
  description = "First availability zone"
  type        = string
}

variable "az_2" {
  description = "Second availability zone"
  type        = string
}

variable "public_subnet_1_cidr" {
  description = "CIDR for public subnet 1"
  type        = string
}

variable "public_subnet_2_cidr" {
  description = "CIDR for public subnet 2"
  type        = string
}

variable "private_subnet_1_cidr" {
  description = "CIDR for private subnet 1"
  type        = string
}

variable "private_subnet_2_cidr" {
  description = "CIDR for private subnet 2"
  type        = string
}

variable "ami_id" {
  description = "AMI ID for EC2"
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.micro"
}

variable "subnet_id" {
  description = "Subnet ID where EC2 will be created"
  type        = string
}

variable "security_group_id" {
  description = "Security Group ID"
  type        = string
}

variable "key_name" {
  description = "EC2 key pair name"
  type        = string
}

variable "root_volume_size" {
  description = "Root EBS volume size in GB"
  type        = number
  default     = 20
}

variable "instance_name" {
  description = "Name tag for EC2"
  type        = string
  default     = "dev-app-server"
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "ssh_cidr" {
  description = "CIDR allowed for SSH"
  type        = string
}
