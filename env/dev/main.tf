module "networking" {
  source = "../../modules/networking"

  vpc_name = var.vpc_name
  vpc_cidr = var.vpc_cidr

  az_1                 = var.az_1
  az_2                 = var.az_2
  public_subnet_1_cidr = var.public_subnet_1_cidr
  public_subnet_2_cidr = var.public_subnet_2_cidr

  private_subnet_1_cidr = var.private_subnet_1_cidr
  private_subnet_2_cidr = var.private_subnet_2_cidr
}



module "compute" {

  source = "../../modules/compute"

  vpc_id = module.networking.vpc_id

  subnet_id = module.networking.public_subnet_ids[0]

  ami_id        = var.ami_id
  instance_type = var.instance_type

  key_name = var.key_name
  ssh_cidr = var.ssh_cidr

  instance_name    = var.instance_name
  root_volume_size = var.root_volume_size
}