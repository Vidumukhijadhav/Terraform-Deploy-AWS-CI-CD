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