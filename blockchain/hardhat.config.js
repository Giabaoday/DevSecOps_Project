require("dotenv").config();
console.log("PRIVATE_KEY:", process.env.PRIVATE_KEY);
console.log("INFURA_API_KEY:", process.env.INFURA_API_KEY);
console.log("CONTRACT_ADDRESS:", process.env.CONTRACT_ADDRESS);

require("@nomiclabs/hardhat-ethers");

module.exports = {
  solidity: "0.8.20",
  defaultNetwork: "sepolia",
  networks: {
    hardhat: {},
    sepolia: {
      url: `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY.trim()] : [],
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
