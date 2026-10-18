vpc_name              = "my-vpc"
vpc_cidr              = "10.0.0.0/16"
az_1                  = "us-west-2a"
az_2                  = "us-west-2b"
public_subnet_1_cidr  = "10.0.1.0/24"
public_subnet_2_cidr  = "10.0.2.0/24"
private_subnet_1_cidr = "10.0.3.0/24"
private_subnet_2_cidr = "10.0.4.0/24"

ami_id = "ami-02167eae61967e403"


instance_type = "t3.micro"


key_name = "promethious"

root_volume_size = 20

instance_name = "vidumukhi"

ssh_cidr          = "0.0.0.0/0"
security_group_id = "var.instance_name-sg"
vpc_id            = "vpc-0573bb543424243a1"
subnet_id         = "subnet-0982096c479ba3487"