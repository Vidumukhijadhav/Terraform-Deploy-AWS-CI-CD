output "vpc_id" {
  value = module.networking.vpc_id
}

output "vpc_cidr" {
  value = module.networking.vpc_cidr
}

output "internet_gateway_id" {
  value = module.networking.internet_gateway_id
}

output "public_subnet_ids" {
  value = [
    module.networking.public_subnet_ids[0],
    module.networking.public_subnet_ids[1]
  ]
}

output "private_subnet_ids" {
  value = [
    module.networking.private_subnet_ids[0],
    module.networking.private_subnet_ids[1]
  ]
}

output "public_route_table_id" {
  value = module.networking.public_route_table_id
}

output "private_route_table_id" {
  value = module.networking.private_route_table_id
}
output "instance_public_ip" {
  value = module.compute.public_ip
}
