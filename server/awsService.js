const AWS = require("aws-sdk");
const fs = require("fs");
const path = require("path");

const amiMap = {
  "us-east-1": "ami-0a95742fa68074ab3",
  "us-east-2": "ami-0a937113f61d791c4",
  "us-west-1": "ami-03f95ca09b41eb7cf",
  "us-west-2": "ami-08d58210ab59c8bb4",
  "ca-central-1": "ami-07325bb2fb3708ff4",
  "eu-west-3": "ami-0d8efe36c7feccc14",
  "eu-south-1": "ami-0850cc588c27111ae",
  "eu-south-2": "ami-0fcff755a596caf64",
  "eu-central-1": "ami-069ea64ab004b5891",
  "eu-west-2": "ami-0d325f80fc1c02e87",
  "eu-north-1": "ami-0c8c5b4f5fe0290d9",
  "ap-east-1": "ami-0c215dc8c54f3af64",
  "ap-northeast-1": "ami-03132fd81a4078070",
  "ap-northeast-2": "ami-09fbc56c965fcebfa",
  "ap-southeast-1": "ami-050f8157cce4f66e6",
  "ap-southeast-2": "ami-01a1b612ef3beb4dd"
};

function getEC2WithKey(region, awsKey) {
  return new AWS.EC2({
    accessKeyId: awsKey.accessKeyId,
    secretAccessKey: awsKey.secretAccessKey,
    region,
  });
}

function getSSMWithKey(region, awsKey) {
  return new AWS.SSM({
    accessKeyId: awsKey.accessKeyId,
    secretAccessKey: awsKey.secretAccessKey,
    region,
  });
}

async function getDefaultVpcId(ec2) {
  const result = await ec2.describeVpcs({
    Filters: [{ Name: "isDefault", Values: ["true"] }],
  }).promise();
  return result.Vpcs[0]?.VpcId;
}

async function ensureKeyPair(ec2, region, keyName) {
  const keyPath = path.join(__dirname, `../keys/${keyName}.pem`);

  let keyPairExistsInAWS = true;
  try {
    await ec2.describeKeyPairs({ KeyNames: [keyName] }).promise();
  } catch (err) {
    if (err.code === "InvalidKeyPair.NotFound") {
      keyPairExistsInAWS = false;
    } else {
      throw err;
    }
  }

  const pemExistsLocally = fs.existsSync(keyPath);

  if (!pemExistsLocally || !keyPairExistsInAWS) {
    if (keyPairExistsInAWS) {
      await ec2.deleteKeyPair({ KeyName: keyName }).promise();
    }

    const result = await ec2.createKeyPair({ KeyName: keyName }).promise();
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, result.KeyMaterial, { mode: 0o600 });
  }

  return keyName;
}

async function ensureSecurityGroup(ec2, groupName, vpcId) {
  let groupId;
  try {
    const res = await ec2.describeSecurityGroups({
      Filters: [
        { Name: "group-name", Values: [groupName] },
        { Name: "vpc-id", Values: [vpcId] },
      ],
    }).promise();

    if (res.SecurityGroups.length > 0) {
      groupId = res.SecurityGroups[0].GroupId;
    } else {
      throw new Error("Security group not found");
    }
  } catch {
    const createRes = await ec2.createSecurityGroup({
      GroupName: groupName,
      Description: "Allow all traffic",
      VpcId: vpcId,
    }).promise();
    groupId = createRes.GroupId;
  }

  const permissions = [{ IpProtocol: "-1", IpRanges: [{ CidrIp: "0.0.0.0/0" }] }];

  try {
    await ec2.authorizeSecurityGroupIngress({ GroupId: groupId, IpPermissions: permissions }).promise();
  } catch (err) {
    if (err.code !== "InvalidPermission.Duplicate") throw err;
  }

  try {
    await ec2.authorizeSecurityGroupEgress({ GroupId: groupId, IpPermissions: permissions }).promise();
  } catch (err) {
    if (err.code !== "InvalidPermission.Duplicate") throw err;
  }

  return groupId;
}

async function createEc2InstanceWithAutoKeyAndSG(region, awsKey) {
  const ec2 = getEC2WithKey(region, awsKey);
  const keyName = `ads-global-key`;
  const sgName = `ads-sg-${region}`;
  const vpcId = await getDefaultVpcId(ec2);

  await ensureKeyPair(ec2, region, keyName);
  const sgId = await ensureSecurityGroup(ec2, sgName, vpcId);

  let imageId = amiMap[region];
  if (!imageId) throw new Error("该区域无 AMI 映射");

  const userDataScript = `#!/bin/bash
  yum install -y dante-server
  ...[省略自定义脚本]...
  `;

  const params = {
    ImageId: imageId,
    InstanceType: "t2.micro",
    MinCount: 1,
    MaxCount: 1,
    KeyName: keyName,
    SecurityGroupIds: [sgId],
    IamInstanceProfile: { Name: "SSMInstanceRole" },
    UserData: Buffer.from(userDataScript).toString("base64"),
  };

  const result = await ec2.runInstances(params).promise();
  return result.Instances[0];
}

async function describeInstances(region, awsKey) {
  const ec2 = getEC2WithKey(region, awsKey);
  const res = await ec2.describeInstances().promise();
  const instances = [];
  res.Reservations.forEach((r) => {
    r.Instances.forEach((inst) => {
      instances.push({
        InstanceId: inst.InstanceId,
        State: inst.State,
        PublicIpAddress: inst.PublicIpAddress || "",
        SecurityGroups: inst.SecurityGroups || [],
        Socks5Status: inst.Tags?.find(tag => tag.Key === 'Socks5')?.Value || '未创建'
      });
    });
  });
  return instances;
}

async function waitForSsmInstance(instanceId, region, awsKey) {
  const ssm = getSSMWithKey(region, awsKey);
  for (let i = 0; i < 24; i++) {
    const info = await ssm.describeInstanceInformation().promise();
    if (info.InstanceInformationList.some((inst) => inst.InstanceId === instanceId)) return true;
    await new Promise((res) => setTimeout(res, 5000));
  }
  throw new Error(`实例 ${instanceId} 未注册到 SSM`);
}

async function createSocks5(instanceId, region, awsKey) {
  const ec2 = getEC2WithKey(region, awsKey);
  await waitForSsmInstance(instanceId, region, awsKey);
  await ec2.createTags({
    Resources: [instanceId],
    Tags: [{ Key: "Socks5", Value: "已创建" }],
  }).promise();
  return { success: true };
}

async function terminateInstance(instanceId, region, awsKey) {
  const ec2 = getEC2WithKey(region, awsKey);
  await ec2.deleteTags({ Resources: [instanceId], Tags: [{ Key: "Socks5" }] }).promise();
  await ec2.terminateInstances({ InstanceIds: [instanceId] }).promise();
  await ec2.waitFor("instanceTerminated", { InstanceIds: [instanceId] }).promise();
  return await describeInstances(region, awsKey);
}

async function releaseElasticIP(allocationId, region, awsKey) {
  const ec2 = getEC2WithKey(region, awsKey);
  return await ec2.releaseAddress({ AllocationId: allocationId }).promise();
}

async function changeElasticIP(instanceId, region, awsKey) {
  const ec2 = getEC2WithKey(region, awsKey);
  const allocateRes = await ec2.allocateAddress({ Domain: 'vpc' }).promise();
  const newAllocationId = allocateRes.AllocationId;
  const newPublicIp = allocateRes.PublicIp;

  const describe = await ec2.describeAddresses({
    Filters: [{ Name: 'instance-id', Values: [instanceId] }],
  }).promise();
  const oldAllocationId = describe.Addresses[0]?.AllocationId;

  await ec2.associateAddress({ AllocationId: newAllocationId, InstanceId: instanceId }).promise();

  if (oldAllocationId) {
    await ec2.releaseAddress({ AllocationId: oldAllocationId }).promise();
  }

  return newPublicIp;
}

async function authorizeAmiToAccount(accountId) {
  const results = [];
  for (const [region, amiId] of Object.entries(amiMap)) {
    const ec2 = new AWS.EC2({ region });
    try {
      await ec2.modifyImageAttribute({
        ImageId: amiId,
        LaunchPermission: { Add: [{ UserId: accountId }] },
      }).promise();
      results.push({ region, amiId, status: 'success' });
    } catch (err) {
      results.push({ region, amiId, status: 'failed', error: err.message });
    }
  }
  return results;
}

module.exports = {
  createEc2InstanceWithAutoKeyAndSG,
  describeInstances,
  createSocks5,
  terminateInstance,
  releaseElasticIP,
  changeElasticIP,
  authorizeAmiToAccount,
};


