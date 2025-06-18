//TEST MESSAGE
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const Web3 = require('web3');

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const cognito = new AWS.CognitoIdentityServiceProvider();
const secretsManager = new AWS.SecretsManager();

// Constants
const TABLE_NAME = process.env.DYNAMODB_TABLE;
const REGION = process.env.AWS_REGION || 'ap-southeast-1';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const BLOCKCHAIN_SECRETS_NAME = process.env.BLOCKCHAIN_SECRETS_NAME || 'devsecops/blockchain';

// Blockchain Configuration
let blockchainInitialized = false;
let INFURA_API_KEY = null;
let PRIVATE_KEY = null;
let CONTRACT_ADDRESS = null;
let web3 = null;
let account = null;
let contract = null;

// Enhanced Contract ABI with trace functions
const CONTRACT_ABI = [
  {
    "inputs": [{"name": "productId", "type": "string"}, {"name": "name", "type": "string"}, {"name": "batch", "type": "string"}, {"name": "manufacturer", "type": "string"}],
    "name": "registerProduct",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "productId", "type": "string"}, {"name": "newStatus", "type": "string"}],
    "name": "updateProductStatus",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "productId", "type": "string"}, {"name": "stage", "type": "string"}, {"name": "company", "type": "string"}, {"name": "location", "type": "string"}],
    "name": "addTraceRecord",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "productId", "type": "string"}],
    "name": "getProduct",
    "outputs": [{"name": "", "type": "string"}, {"name": "", "type": "string"}, {"name": "", "type": "string"}, {"name": "", "type": "string"}, {"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [{"indexed": false, "name": "productId", "type": "string"}, {"indexed": false, "name": "name", "type": "string"}, {"indexed": false, "name": "manufacturer", "type": "string"}],
    "name": "ProductRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{"indexed": false, "name": "productId", "type": "string"}, {"indexed": false, "name": "newStatus", "type": "string"}],
    "name": "ProductStatusUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{"indexed": false, "name": "productId", "type": "string"}, {"indexed": false, "name": "stage", "type": "string"}, {"indexed": false, "name": "company", "type": "string"}],
    "name": "TraceRecordAdded",
    "type": "event"
  }
];

// User roles
const USER_ROLES = {
  CONSUMER: 'consumer',
  MANUFACTURER: 'manufacturer',
  RETAILER: 'retailer'
};

async function initializeBlockchain() {
  if (blockchainInitialized) {
    return;
  }

  try {
    console.log('Initializing blockchain configuration...');
    
    const response = await secretsManager.getSecretValue({
      SecretId: BLOCKCHAIN_SECRETS_NAME
    }).promise();
    
    const secrets = JSON.parse(response.SecretString);
    
    INFURA_API_KEY = secrets.INFURA_API_KEY;
    PRIVATE_KEY = secrets.PRIVATE_KEY;
    CONTRACT_ADDRESS = secrets.CONTRACT_ADDRESS;
    
    if (!INFURA_API_KEY || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
      console.error('Missing blockchain configuration:', {
        infura: !!INFURA_API_KEY,
        privateKey: !!PRIVATE_KEY,
        contract: !!CONTRACT_ADDRESS
      });
      throw new Error('Missing required blockchain configuration');
    }
    
    const providerUrl = `https://sepolia.infura.io/v3/${INFURA_API_KEY}`;
    web3 = new Web3(new Web3.providers.HttpProvider(providerUrl));
    
    const formattedPrivateKey = PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : '0x' + PRIVATE_KEY;
    
    account = web3.eth.accounts.privateKeyToAccount(formattedPrivateKey);
    web3.eth.accounts.wallet.add(account);
    web3.eth.defaultAccount = account.address;
    
    const networkId = await web3.eth.net.getId();
    console.log('Connected to network:', networkId);
    
    const balance = await web3.eth.getBalance(account.address);
    console.log('Account balance:', web3.utils.fromWei(balance, 'ether'), 'ETH');
    
    if (parseFloat(web3.utils.fromWei(balance, 'ether')) < 0.001) {
      console.warn('⚠️  Low account balance, transactions may fail');
    }
    
    contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
    
    blockchainInitialized = true;
    console.log('✅ Blockchain initialized successfully');
    
  } catch (error) {
    console.error('❌ Failed to initialize blockchain:', error);
    console.warn('⚠️  Continuing without blockchain functionality');
    blockchainInitialized = false;
  }
}

// ===== ENHANCED BLOCKCHAIN FUNCTIONS =====

async function addTraceRecordToBlockchain(productId, stage, company, location) {
  try {
    console.log('🔗 Adding trace record to blockchain:', { productId, stage, company, location });
    
    const params = [
      String(productId).trim(),
      String(stage).trim(), 
      String(company).trim(),
      String(location).trim()
    ];
    
    // Get current gas price and increase it by 20% to avoid underpriced errors
    const baseGasPrice = await web3.eth.getGasPrice();
    const gasPrice = Math.floor(Number(baseGasPrice) * 1.2).toString();
    
    console.log('Gas price calculation:', {
      baseGasPrice: web3.utils.fromWei(baseGasPrice, 'gwei') + ' gwei',
      adjustedGasPrice: web3.utils.fromWei(gasPrice, 'gwei') + ' gwei'
    });
    
    let gasEstimate;
    try {
      gasEstimate = await contract.methods.addTraceRecord(...params).estimateGas({
        from: account.address
      });
    } catch (estimateError) {
      console.warn('⚠️  Gas estimation failed for trace record:', estimateError.message);
      gasEstimate = 250000; // Default gas limit if estimation fails
    }
    
    // Add 20% buffer to gas estimate
    const gasLimit = Math.floor(Number(gasEstimate) * 1.2);
    
    const txOptions = {
      from: account.address,
      gas: gasLimit,
      gasPrice: gasPrice,
      nonce: await web3.eth.getTransactionCount(account.address, 'latest')
    };
    
    console.log('Transaction options:', {
      gasLimit: gasLimit,
      gasPrice: web3.utils.fromWei(gasPrice, 'gwei') + ' gwei',
      nonce: txOptions.nonce
    });
    
    const tx = await contract.methods.addTraceRecord(...params).send(txOptions);
    
    console.log('✅ Trace record added to blockchain:', tx.transactionHash);
    return tx.transactionHash;
    
  } catch (error) {
    console.error('❌ Blockchain trace record error:', error);
    
    // Handle specific error cases
    if (error.message.includes('replacement transaction underpriced')) {
      throw new Error('Transaction gas price too low. Please try again with higher gas price.');
    } else if (error.message.includes('insufficient funds')) {
      throw new Error('Insufficient funds for blockchain transaction');
    } else if (error.message.includes('nonce')) {
      throw new Error('Transaction nonce error - please try again');
    } else if (error.message.includes('gas')) {
      throw new Error('Gas estimation failed - network may be congested');
    } else {
      throw new Error('Failed to add trace record to blockchain: ' + error.message);
    }
  }
}

async function registerProductOnBlockchain(productId, name, batch, manufacturer) {
  try {
    console.log('🔗 Registering product on blockchain:', { productId, name, batch, manufacturer });
    
    const params = [
      String(productId).trim(),
      String(name).trim(), 
      String(batch).trim(),
      String(manufacturer).trim()
    ];
    
    const gasPrice = await web3.eth.getGasPrice();
    
    let gasEstimate;
    try {
      gasEstimate = await contract.methods.registerProduct(...params).estimateGas({
        from: account.address
      });
    } catch (estimateError) {
      console.warn('⚠️  Gas estimation failed, using default:', estimateError.message);
      gasEstimate = 300000;
    }
    
    const txOptions = {
      from: account.address,
      gas: Math.floor(Number(gasEstimate) * 1.2),
      gasPrice: String(gasPrice)
    };
    
    const tx = await contract.methods.registerProduct(...params).send(txOptions);
    
    console.log('✅ Product registered on blockchain:', tx.transactionHash);
    return tx.transactionHash;
    
  } catch (error) {
    console.error('❌ Blockchain registration error:', error);
    
    if (error.message.includes('insufficient funds')) {
      throw new Error('Insufficient funds for blockchain transaction');
    } else if (error.message.includes('gas')) {
      throw new Error('Gas estimation failed - network may be congested');
    } else if (error.message.includes('revert')) {
      throw new Error('Smart contract rejected transaction - product may already exist');
    } else if (error.message.includes('nonce')) {
      throw new Error('Transaction nonce error - please try again');
    } else {
      throw new Error('Blockchain transaction failed: ' + error.message);
    }
  }
}

async function updateProductStatusOnBlockchain(productId, status) {
  try {
    console.log('🔄 Updating product status on blockchain:', { productId, status });
    
    const params = [String(productId).trim(), String(status).trim()];
    
    const gasPrice = await web3.eth.getGasPrice();
    
    let gasEstimate;
    try {
      gasEstimate = await contract.methods.updateProductStatus(...params).estimateGas({
        from: account.address
      });
    } catch (estimateError) {
      console.warn('⚠️  Gas estimation failed for status update:', estimateError.message);
      gasEstimate = 200000;
    }
    
    const txOptions = {
      from: account.address,
      gas: Math.floor(Number(gasEstimate) * 1.2),
      gasPrice: String(gasPrice)
    };
    
    const tx = await contract.methods.updateProductStatus(...params).send(txOptions);
    
    console.log('✅ Product status updated on blockchain:', tx.transactionHash);
    return tx.transactionHash;
    
  } catch (error) {
    console.error('❌ Blockchain status update error:', error);
    
    if (error.message.includes('revert')) {
      throw new Error('Product not found on blockchain or unauthorized access');
    } else if (error.message.includes('insufficient funds')) {
      throw new Error('Insufficient funds for blockchain transaction');
    } else {
      throw new Error('Failed to update product status on blockchain: ' + error.message);
    }
  }
}

async function getProductFromBlockchain(productId) {
  try {
    console.log('🔍 Reading product from blockchain:', productId);
    
    const result = await contract.methods.getProduct(String(productId).trim()).call();
    
    if (!result || result.length < 5) {
      console.log('📭 Product not found on blockchain');
      return null;
    }
    
    if (!result[0] || result[0] === '') {
      console.log('📭 Empty product data on blockchain');
      return null;
    }
    
    return {
      name: String(result[0] || ''),
      batch: String(result[1] || ''),
      manufacturer: String(result[2] || ''),
      status: String(result[3] || 'Created'),
      timestamp: result[4] ? parseInt(result[4]) : 0
    };
    
  } catch (error) {
    console.error('❌ Blockchain read error:', error);
    
    if (error.message.includes('revert') || error.message.includes('not found')) {
      console.log('📭 Product not found on blockchain');
      return null;
    }
    
    console.warn('⚠️  Failed to read from blockchain, returning null');
    return null;
  }
}

// ===== USER MANAGEMENT FUNCTIONS =====

async function getUserProfileWithRole(userId) {
  try {
    const params = {
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: 'PROFILE'
      }
    };

    const result = await dynamoDB.get(params).promise();
    
    if (!result.Item) {
      const defaultUser = {
        userId: userId,
        username: "user_" + userId.substring(0, 8),
        role: USER_ROLES.CONSUMER,
        createdAt: new Date().toISOString()
      };
      
      await dynamoDB.put({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userId}`,
          SK: 'PROFILE',
          GSI1PK: 'TYPE#USER',
          GSI1SK: defaultUser.username,
          ...defaultUser,
          updatedAt: defaultUser.createdAt
        }
      }).promise();
      
      console.log('Created default user profile for:', userId);
      return defaultUser;
    }
    
    return {
      userId: result.Item.userId,
      username: result.Item.username,
      email: result.Item.email,
      name: result.Item.name,
      role: result.Item.role,
      createdAt: result.Item.createdAt,
      updatedAt: result.Item.updatedAt
    };
  } catch (error) {
    console.error('Error getting user profile:', error);
    return {
      userId: userId,
      username: "user_" + userId.substring(0, 8),
      role: USER_ROLES.CONSUMER
    };
  }
}

function hasRole(userRole, allowedRoles) {
  return allowedRoles.includes(userRole);
}

// ===== INVENTORY MANAGEMENT =====

async function updateInventory(userId, productId, quantityChange, operation) {
  try {
    console.log('📦 Updating inventory:', { userId, productId, quantityChange, operation });
    
    // Get current inventory
    const currentInventory = await dynamoDB.get({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `INVENTORY#${productId}`
      }
    }).promise();
    
    const currentQuantity = currentInventory.Item?.quantity || 0;
    const newQuantity = operation === 'add' ? currentQuantity + quantityChange : currentQuantity - quantityChange;
    
    if (newQuantity < 0) {
      throw new Error('Insufficient inventory quantity');
    }
    
    // Update inventory
    await dynamoDB.put({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${userId}`,
        SK: `INVENTORY#${productId}`,
        GSI1PK: 'TYPE#INVENTORY',
        GSI1SK: `${userId}#${productId}`,
        userId: userId,
        productId: productId,
        quantity: newQuantity,
        updatedAt: new Date().toISOString()
      }
    }).promise();
    
    console.log(`✅ Inventory updated: ${currentQuantity} → ${newQuantity}`);
    return newQuantity;
    
  } catch (error) {
    console.error('Error updating inventory:', error);
    throw error;
  }
}

async function getInventory(userId, productId = null) {
  try {
    if (productId) {
      // Get specific product inventory
      const result = await dynamoDB.get({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `INVENTORY#${productId}`
        }
      }).promise();
      
      return result.Item ? result.Item.quantity : 0;
    } else {
      // Get all inventory for user
      const result = await dynamoDB.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': 'INVENTORY#'
        }
      }).promise();
      
      return result.Items.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        updatedAt: item.updatedAt
      }));
    }
  } catch (error) {
    console.error('Error getting inventory:', error);
    return productId ? 0 : [];
  }
}

// ===== MAIN HANDLER =====

const originalHandler = async (event) => {
  console.log('🚀 API Gateway Event:', JSON.stringify(event, null, 2));

  await initializeBlockchain();

  try {
    const { requestContext, pathParameters, queryStringParameters, body } = event;
    
    const httpMethod = event.httpMethod || (event.requestContext?.http?.method);
    const routeKey = event.routeKey || `${httpMethod} ${event.resource}`;
    const path = event.path || event.resource || routeKey?.split(' ')[1];
    
    let userId = null;
    let userProfile = null;
    let userRole = null;
    
    const publicRoutes = ['/health', '/public/verify', '/public/trace'];
    const isPublicRoute = publicRoutes.some(route => path.includes(route)) || httpMethod === 'OPTIONS';
    
    if (!isPublicRoute) {
      if (requestContext?.authorizer?.jwt?.claims?.sub) {
        userId = requestContext.authorizer.jwt.claims.sub;
      } else if (requestContext?.authorizer?.claims?.sub) {
        userId = requestContext.authorizer.claims.sub;
      }
      
      if (!userId) {
        return formatResponse(401, { message: 'Unauthorized: Missing user ID' });
      }
      
      userProfile = await getUserProfileWithRole(userId);
      userRole = userProfile.role;
      
      console.log('👤 User authenticated:', {
        userId: userId,
        username: userProfile.username,
        role: userRole
      });
    }
    
    const parsedBody = body ? (typeof body === 'string' ? JSON.parse(body) : body) : {};

    let response;
    
    // Health Check Route
    if (path === '/health' && httpMethod === 'GET') {
      response = await healthCheck();
    }
    
    // CORS Options Route
    else if (httpMethod === 'OPTIONS') {
      return formatResponse(200, { message: 'CORS OK' });
    }
    
    // Public Routes
    else if (path === '/public/verify' && httpMethod === 'GET') {
      const productCode = queryStringParameters?.code;
      response = await verifyProductOnBlockchain(productCode);
    }
    else if (path === '/public/trace' && httpMethod === 'GET') {
      const productCode = queryStringParameters?.code;
      response = await traceProductWithBlockchain(productCode);
    }
    
    // User Management Routes
    else if (path === '/users/me' && httpMethod === 'GET') {
      response = userProfile;
    }
    else if (path === '/users/update-role' && httpMethod === 'POST') {
      response = await updateUserRole(userId, parsedBody);
    }
    
    // Product Management Routes
    else if (path === '/products' && httpMethod === 'GET') {
      response = await getProducts(userId, userRole, queryStringParameters);
    }
    else if (path === '/products' && httpMethod === 'POST') {
      if (!hasRole(userRole, [USER_ROLES.MANUFACTURER])) {
        return formatResponse(403, { message: 'Only manufacturers can create products' });
      }
      response = await createProductWithBlockchain(userId, userProfile, parsedBody);
    }
    else if (path?.startsWith('/products/') && httpMethod === 'GET') {
      const productId = pathParameters?.id;
      response = await getProductWithBlockchain(userId, userRole, productId);
    }
    else if (path?.startsWith('/products/') && httpMethod === 'PUT') {
      const productId = pathParameters?.id;
      if (!hasRole(userRole, [USER_ROLES.MANUFACTURER])) {
        return formatResponse(403, { message: 'Only manufacturers can update products' });
      }
      response = await updateProductWithBlockchain(userId, userRole, productId, parsedBody);
    }
    else if (path?.startsWith('/products/') && httpMethod === 'DELETE') {
      const productId = pathParameters?.id;
      if (!hasRole(userRole, [USER_ROLES.MANUFACTURER])) {
        return formatResponse(403, { message: 'Only manufacturers can delete products' });
      }
      response = await deleteProduct(userId, userRole, productId);
    }
    
    // Blockchain Verification Routes
    else if (path === '/verify' && httpMethod === 'GET') {
      const productCode = queryStringParameters?.code;
      response = await verifyProductOnBlockchain(productCode);
    }
    
    // Order Management Routes
    else if (path === '/orders' && httpMethod === 'GET') {
      response = await getOrders(userId, userRole, queryStringParameters);
    }
    else if (path === '/orders' && httpMethod === 'POST') {
      if (!hasRole(userRole, [USER_ROLES.MANUFACTURER, USER_ROLES.RETAILER])) {
        return formatResponse(403, { message: 'Only manufacturers and retailers can create orders' });
      }
      response = await createOrderWithBlockchain(userId, userProfile, parsedBody);
    }
    else if (path?.startsWith('/orders/') && httpMethod === 'PUT') {
      const orderId = pathParameters?.id;
      if (!hasRole(userRole, [USER_ROLES.MANUFACTURER, USER_ROLES.RETAILER])) {
        return formatResponse(403, { message: 'Only manufacturers and retailers can update orders' });
      }
      response = await updateOrderStatusWithBlockchain(userId, userRole, orderId, parsedBody);
    }
    
    // Traceability Routes
    else if (path === '/trace' && httpMethod === 'GET') {
      const productCode = queryStringParameters?.code;
      response = await traceProductWithBlockchain(productCode);
    }
    
    // Company listing routes
    else if (path === '/manufacturers' && httpMethod === 'GET') {
      response = await getManufacturers();
    }
    else if (path === '/retailers' && httpMethod === 'GET') {
      response = await getRetailers();
    }
    
    // Inventory routes
    else if (path === '/inventory' && httpMethod === 'GET') {
      response = await getUserInventory(userId, userRole);
    }
    
    else {
      return formatResponse(404, { message: 'Route not found', path: path, method: httpMethod });
    }

    return formatResponse(200, response);
  } catch (error) {
    console.error('❌ Handler Error:', error);
    
    if (error.code === 'ConditionalCheckFailedException') {
      return formatResponse(400, { message: 'Item does not exist or you do not have permission' });
    }
    
    return formatResponse(500, { 
      message: 'Internal server error', 
      error: error.message,
      blockchain: blockchainInitialized ? 'connected' : 'disconnected'
    });
  }
};

exports.handler = async (event, context) => {
  if (event.triggerSource && event.version) {
    console.log('🔐 Cognito Trigger Event:', JSON.stringify(event, null, 2));
    return handleCognitoTrigger(event, context);
  }
  
  return originalHandler(event);
};

// ===== ENHANCED FUNCTIONS =====

async function updateUserRole(userId, requestBody) {
  try {
    const { role } = requestBody;
    
    if (!Object.values(USER_ROLES).includes(role)) {
      throw new Error('Invalid role. Valid roles: ' + Object.values(USER_ROLES).join(', '));
    }
    
    const timestamp = new Date().toISOString();
    
    await dynamoDB.update({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: 'PROFILE'
      },
      UpdateExpression: 'SET #role = :role, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#role': 'role'
      },
      ExpressionAttributeValues: {
        ':role': role,
        ':updatedAt': timestamp
      }
    }).promise();
    
    return {
      message: 'User role updated successfully',
      role: role,
      updatedAt: timestamp
    };
    
  } catch (error) {
    console.error('Error updating user role:', error);
    throw new Error('Could not update user role: ' + error.message);
  }
}

async function getProducts(userId, userRole, queryParams) {
  const scope = queryParams?.scope || 'all';
  let params;
  
  if (scope === 'personal' && userRole === USER_ROLES.MANUFACTURER) {
    params = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'PRODUCT#'
      }
    };
  } else {
    params = {
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'TYPE#PRODUCT'
      }
    };
  }
  
  const result = await dynamoDB.query(params).promise();
  
  // If retailer, also get inventory for each product
  const products = await Promise.all(result.Items.map(async (item) => {
    let inventoryQuantity = item.quantity || 0;
    
    // For retailers, get their inventory quantity instead of manufacturer's quantity
    if (userRole === USER_ROLES.RETAILER && item.manufacturerId !== userId) {
      inventoryQuantity = await getInventory(userId, item.productId);
    }
    
    return {
      id: item.productId || item.SK.split('#')[1],
      name: item.name,
      category: item.category,
      description: item.description,
      batch: item.batch,
      quantity: inventoryQuantity,
      originalQuantity: item.quantity || 0, // Original manufacturer quantity
      price: item.price || 0,
      manufacturer: item.manufacturer || item.manufacturerName,
      manufacturerId: item.manufacturerId,
      blockchainTxHash: item.blockchainTxHash,
      blockchainStatus: item.blockchainStatus,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  }));
  
  return { products };
}

async function createProductWithBlockchain(userId, userProfile, productData) {
  const { name, category, description, quantity = 0, price = 0, batch } = productData;
  
  if (!name || !category || !batch) {
    throw new Error('Product name, category, and batch are required');
  }
  
  const productId = uuidv4();
  const timestamp = new Date().toISOString();
  
  let txHash = null;
  let blockchainStatus = 'pending';
  
  try {
    if (blockchainInitialized) {
      console.log('🔗 Attempting blockchain registration...');
      txHash = await registerProductOnBlockchain(
        productId, 
        name, 
        batch, 
        userProfile.name || userProfile.username
      );
      blockchainStatus = 'registered';
      console.log('✅ Blockchain registration successful');
    } else {
      console.warn('⚠️  Blockchain not initialized, creating product without blockchain registration');
      blockchainStatus = 'not_registered';
    }
  } catch (blockchainError) {
    console.error('❌ Blockchain registration failed:', blockchainError);
    blockchainStatus = 'failed';
    console.log('📝 Continuing with database-only product creation...');
  }
  
  // Save to DynamoDB
  const productItem = {
    PK: `USER#${userId}`,
    SK: `PRODUCT#${productId}`,
    GSI1PK: 'TYPE#PRODUCT',
    GSI1SK: `${category}#${name}`,
    productId,
    name,
    category,
    description,
    batch,
    quantity: parseInt(quantity) || 0,
    price: parseInt(price) || 0,
    manufacturer: userProfile.name || userProfile.username,
    manufacturerId: userId,
    blockchainTxHash: txHash,
    blockchainStatus: blockchainStatus,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  
  await dynamoDB.put({
    TableName: TABLE_NAME,
    Item: productItem
  }).promise();
  
  // Initialize manufacturer's inventory
  await updateInventory(userId, productId, parseInt(quantity) || 0, 'add');
  
  const message = txHash 
    ? 'Product created and registered on blockchain successfully'
    : `Product created successfully (blockchain status: ${blockchainStatus})`;
  
  return {
    message,
    product: {
      id: productId,
      name,
      category,
      description,
      batch,
      quantity: parseInt(quantity) || 0,
      price: parseInt(price) || 0,
      manufacturer: userProfile.name || userProfile.username,
      blockchainTxHash: txHash,
      blockchainStatus: blockchainStatus,
      createdAt: timestamp
    }
  };
}

async function createOrderWithBlockchain(userId, userProfile, orderData) {
  const { type, productId, quantity, recipientId, recipientName, supplierName, customerInfo, notes } = orderData;
  
  if (!productId || !quantity || quantity <= 0) {
    throw new Error('Product ID and valid quantity are required');
  }
  
  const orderId = uuidv4();
  const timestamp = new Date().toISOString();
  
  // Get product information
  const productInfo = await getProductInfo(productId);
  if (!productInfo) {
    throw new Error('Product not found');
  }
  
  // Check inventory for sales
  if (type === 'sale') {
    const currentInventory = await getInventory(userId, productId);
    if (currentInventory < quantity) {
      throw new Error(`Insufficient inventory. Available: ${currentInventory}, Requested: ${quantity}`);
    }
  }
  
  // Enhanced order item with proper recipient/supplier information
  const orderItem = {
    PK: `USER#${userId}`,
    SK: `ORDER#${orderId}`,
    GSI1PK: 'TYPE#ORDER',
    GSI1SK: `${type}#${timestamp}`,
    orderId,
    type,
    productId,
    productName: productInfo.name,
    quantity: parseInt(quantity),
    status: 'pending',
    createdBy: userId,
    createdByName: userProfile.name || userProfile.username,
    notes: notes || '',
    createdAt: timestamp,
    updatedAt: timestamp
  };
  
  // Add specific fields based on order type
  if (type === 'export') {
    orderItem.recipientId = recipientId || '';
    orderItem.recipientName = recipientName || recipientId || '';
  } else if (type === 'import') {
    orderItem.supplierId = recipientId || ''; // recipientId is actually supplier for import
    orderItem.supplierName = supplierName || recipientId || '';
  } else if (type === 'sale') {
    orderItem.customerInfo = customerInfo || recipientId || '';
  }
  
  await dynamoDB.put({
    TableName: TABLE_NAME,
    Item: orderItem
  }).promise();
  
  return {
    message: `Order created successfully`,
    order: {
      id: orderId,
      type,
      productId,
      productName: productInfo.name,
      quantity: parseInt(quantity),
      status: 'pending',
      ...(type === 'export' && { recipientName: recipientName || recipientId }),
      ...(type === 'import' && { supplierName: supplierName || recipientId }),
      ...(type === 'sale' && { customerInfo: customerInfo || recipientId }),
      createdAt: timestamp
    }
  };
}

async function updateOrderStatusWithBlockchain(userId, userRole, orderId, updateData) {
  const { status } = updateData;
  
  if (status !== 'completed') {
    // Simple status update for non-completed orders
    await dynamoDB.update({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `ORDER#${orderId}`
      },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':updatedAt': new Date().toISOString()
      },
      ConditionExpression: 'attribute_exists(PK)'
    }).promise();
    
    return { message: 'Order status updated successfully' };
  }
  
  // For completed orders, we need to handle inventory and trace records
  const orderResult = await dynamoDB.get({
    TableName: TABLE_NAME,
    Key: {
      PK: `USER#${userId}`,
      SK: `ORDER#${orderId}`
    }
  }).promise();
  
  if (!orderResult.Item) {
    throw new Error('Order not found');
  }
  
  const order = orderResult.Item;
  const productInfo = await getProductInfo(order.productId);
  
  if (!productInfo) {
    throw new Error('Product information not found');
  }
  
  let txHash = null;
  let traceStage = '';
  let traceCompany = '';
  let traceLocation = 'Vietnam'; // Default location
  
  try {
    // Handle different order types when completed
    if (order.type === 'export') {
      // Manufacturer exporting to retailer
      traceStage = 'Exported';
      traceCompany = order.createdByName;
      
      // Reduce manufacturer inventory
      await updateInventory(userId, order.productId, order.quantity, 'subtract');
      
      // Add trace record to blockchain
      if (blockchainInitialized) {
        txHash = await addTraceRecordToBlockchain(
          order.productId,
          traceStage,
          traceCompany,
          traceLocation
        );
      }
      
      // Save trace record to database
      await saveTraceRecord(order.productId, traceStage, traceCompany, traceLocation, txHash, order);
      
    } else if (order.type === 'import') {
      // Retailer importing from manufacturer
      traceStage = 'Imported';
      traceCompany = order.createdByName;
      
      // Increase retailer inventory
      await updateInventory(userId, order.productId, order.quantity, 'add');
      
      // Add trace record to blockchain
      if (blockchainInitialized) {
        txHash = await addTraceRecordToBlockchain(
          order.productId,
          traceStage,
          traceCompany,
          traceLocation
        );
      }
      
      // Save trace record to database
      await saveTraceRecord(order.productId, traceStage, traceCompany, traceLocation, txHash, order);
      
    } else if (order.type === 'sale') {
      // Retailer selling to customer (no trace record needed, just inventory update)
      await updateInventory(userId, order.productId, order.quantity, 'subtract');
    }
    
  } catch (error) {
    console.error('Error processing completed order:', error);
    // Continue with status update even if blockchain/trace fails
  }
  
  // Update order status
  await dynamoDB.update({
    TableName: TABLE_NAME,
    Key: {
      PK: `USER#${userId}`,
      SK: `ORDER#${orderId}`
    },
    UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, completedAt = :completedAt',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': status,
      ':updatedAt': new Date().toISOString(),
      ':completedAt': new Date().toISOString()
    }
  }).promise();
  
  return { 
    message: 'Order completed successfully',
    traceRecordAdded: !!txHash,
    blockchainTxHash: txHash
  };
}

async function saveTraceRecord(productId, stage, company, location, txHash, orderInfo) {
  const timestamp = new Date().toISOString();
  const traceId = uuidv4();
  
  const traceRecord = {
    PK: `PRODUCT#${productId}`,
    SK: `TRACE#${timestamp}#${traceId}`,
    GSI1PK: 'TYPE#TRACE',
    GSI1SK: `${productId}#${timestamp}`,
    traceId,
    productId,
    stage,
    companyName: company,
    location,
    blockchainTxHash: txHash,
    details: {
      quantity: orderInfo?.quantity,
      orderId: orderInfo?.orderId,
      location: location,
      notes: `${stage} - Quantity: ${orderInfo?.quantity || 'N/A'}`
    },
    timestamp,
    createdAt: timestamp
  };
  
  await dynamoDB.put({
    TableName: TABLE_NAME,
    Item: traceRecord
  }).promise();
  
  console.log('✅ Trace record saved to database');
}

async function getProductInfo(productId) {
  try {
    const params = {
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      FilterExpression: 'productId = :productId',
      ExpressionAttributeValues: {
        ':pk': 'TYPE#PRODUCT',
        ':productId': productId
      }
    };
    
    const result = await dynamoDB.query(params).promise();
    return result.Items.length > 0 ? result.Items[0] : null;
  } catch (error) {
    console.error('Error getting product info:', error);
    return null;
  }
}

async function getProductWithBlockchain(userId, userRole, productId) {
  if (!productId) {
    throw new Error('Product ID is required');
  }
  
  let params = {
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    FilterExpression: 'productId = :productId',
    ExpressionAttributeValues: {
      ':pk': 'TYPE#PRODUCT',
      ':productId': productId
    }
  };
  
  const result = await dynamoDB.query(params).promise();
  
  if (result.Items.length > 0) {
    const item = result.Items[0];
    
    // Get current inventory for the user
    let currentInventory = item.quantity || 0;
    if (userRole === USER_ROLES.RETAILER && item.manufacturerId !== userId) {
      currentInventory = await getInventory(userId, productId);
    }
    
    // Get blockchain data for verification
    const blockchainData = await getProductFromBlockchain(productId);
    
    return {
      id: item.productId,
      name: item.name,
      category: item.category,
      description: item.description,
      batch: item.batch,
      quantity: currentInventory,
      originalQuantity: item.quantity,
      price: item.price,
      manufacturer: item.manufacturer,
      manufacturerId: item.manufacturerId,
      blockchainTxHash: item.blockchainTxHash,
      blockchainData: blockchainData,
      blockchainVerified: blockchainData ? true : false,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  }
  
  throw new Error('Product not found');
}

async function updateProductWithBlockchain(userId, userRole, productId, updateData) {
  const { status } = updateData;
  
  if (status) {
    try {
      const txHash = await updateProductStatusOnBlockchain(productId, status);
      
      await dynamoDB.update({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `PRODUCT#${productId}`
        },
        UpdateExpression: 'SET blockchainStatus = :status, lastBlockchainTxHash = :txHash, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':status': status,
          ':txHash': txHash,
          ':updatedAt': new Date().toISOString()
        },
        ConditionExpression: 'attribute_exists(PK)'
      }).promise();
      
      return { 
        message: 'Product status updated on blockchain successfully',
        blockchainTxHash: txHash
      };
    } catch (error) {
      throw new Error('Failed to update product status: ' + error.message);
    }
  }
  
  return { message: 'Product updated successfully' };
}

async function deleteProduct(userId, userRole, productId) {
  await dynamoDB.delete({
    TableName: TABLE_NAME,
    Key: {
      PK: `USER#${userId}`,
      SK: `PRODUCT#${productId}`
    },
    ConditionExpression: 'attribute_exists(PK)'
  }).promise();
  
  return { message: 'Product deleted successfully' };
}

async function getOrders(userId, userRole, queryParams) {
  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
      ':sk': 'ORDER#'
    }
  };
  
  const result = await dynamoDB.query(params).promise();
  
  const orders = result.Items.map(item => ({
    id: item.orderId || item.SK.split('#')[1],
    type: item.type,
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    status: item.status,
    recipientName: item.recipientName || item.recipientId,
    supplierName: item.supplierName || item.supplierId,
    customerInfo: item.customerInfo,
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt
  }));
  
  return { orders };
}

async function getUserInventory(userId, userRole) {
  const inventory = await getInventory(userId);
  
  // Get product details for each inventory item
  const inventoryWithDetails = await Promise.all(
    inventory.map(async (item) => {
      const productInfo = await getProductInfo(item.productId);
      return {
        ...item,
        productName: productInfo?.name || 'Unknown Product',
        category: productInfo?.category || 'Unknown',
        manufacturer: productInfo?.manufacturer || 'Unknown'
      };
    })
  );
  
  return {
    inventory: inventoryWithDetails,
    totalItems: inventoryWithDetails.length,
    totalQuantity: inventoryWithDetails.reduce((sum, item) => sum + item.quantity, 0)
  };
}

async function verifyProductOnBlockchain(productCode) {
  if (!productCode) {
    throw new Error('Product code is required');
  }
  
  try {
    const blockchainData = await getProductFromBlockchain(productCode);
    
    if (!blockchainData) {
      return {
        verified: false,
        message: 'Product not found on blockchain'
      };
    }
    
    try {
      const dbProduct = await getProductWithBlockchain(null, null, productCode);
      return {
        verified: true,
        productId: productCode,
        blockchainData: blockchainData,
        databaseData: dbProduct,
        verificationTime: new Date().toISOString()
      };
    } catch (dbError) {
      return {
        verified: true,
        productId: productCode,
        blockchainData: blockchainData,
        databaseData: null,
        verificationTime: new Date().toISOString(),
        note: 'Product verified on blockchain but not found in database'
      };
    }
  } catch (error) {
    return {
      verified: false,
      message: error.message,
      productId: productCode
    };
  }
}

async function traceProductWithBlockchain(productCode) {
  if (!productCode) {
    throw new Error('Product code is required');
  }
  
  try {
    const verification = await verifyProductOnBlockchain(productCode);
    
    if (!verification.verified) {
      throw new Error('Product not found or invalid');
    }
    
    // Get trace records from DynamoDB
    const params = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `PRODUCT#${productCode}`
      },
      ScanIndexForward: true
    };
    
    const result = await dynamoDB.query(params).promise();
    
    const traceRecords = result.Items
      .filter(item => item.SK.startsWith('TRACE#'))
      .map(item => ({
        stage: item.stage,
        company: item.companyName,
        date: item.timestamp?.split('T')[0] || item.createdAt?.split('T')[0],
        location: item.location || 'N/A',
        details: item.details?.notes || `${item.stage} - Quantity: ${item.details?.quantity || 'N/A'}`,
        blockchainTxHash: item.blockchainTxHash || 'N/A'
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    return {
      productId: productCode,
      productName: verification.blockchainData.name,
      manufacturer: verification.blockchainData.manufacturer,
      batch: verification.blockchainData.batch,
      currentStatus: verification.blockchainData.status,
      blockchainVerified: true,
      blockchainTimestamp: verification.blockchainData.timestamp,
      trace: traceRecords
    };
  } catch (error) {
    throw new Error('Failed to trace product: ' + error.message);
  }
}

async function getManufacturers() {
  const params = {
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    FilterExpression: '#role = :role',
    ExpressionAttributeNames: {
      '#role': 'role'
    },
    ExpressionAttributeValues: {
      ':pk': 'TYPE#USER',
      ':role': USER_ROLES.MANUFACTURER
    }
  };
  
  try {
    const result = await dynamoDB.query(params).promise();
    
    const manufacturers = await Promise.all(result.Items.map(async (item) => {
      try {
        const productCount = await dynamoDB.query({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `USER#${item.userId}`,
            ':sk': 'PRODUCT#'
          },
          Select: 'COUNT'
        }).promise();
        
        return {
          id: item.userId,
          name: item.name || item.username,
          location: item.location || 'Việt Nam',
          products: productCount.Count,
          rating: 4.5,
          email: item.email
        };
      } catch (countError) {
        console.warn('Failed to count products for manufacturer:', item.userId);
        return {
          id: item.userId,
          name: item.name || item.username,
          location: item.location || 'Việt Nam',
          products: 0,
          rating: 4.5,
          email: item.email
        };
      }
    }));
    
    return { manufacturers };
  } catch (error) {
    console.error('Error getting manufacturers:', error);
    return { manufacturers: [] };
  }
}

async function getRetailers() {
  const params = {
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    FilterExpression: '#role = :role',
    ExpressionAttributeNames: {
      '#role': 'role'
    },
    ExpressionAttributeValues: {
      ':pk': 'TYPE#USER',
      ':role': USER_ROLES.RETAILER
    }
  };
  
  try {
    const result = await dynamoDB.query(params).promise();
    
    const retailers = result.Items.map(item => ({
      id: item.userId,
      name: item.name || item.username,
      location: item.location || 'Việt Nam',
      manufacturers: 5,
      rating: 4.3,
      email: item.email
    }));
    
    return { retailers };
  } catch (error) {
    console.error('Error getting retailers:', error);
    return { retailers: [] };
  }
}

async function healthCheck() {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.1.0',
    blockchain: {
      connected: blockchainInitialized,
      network: 'Sepolia',
      contract: CONTRACT_ADDRESS || 'not-configured',
      account: account?.address || 'not-configured'
    },
    database: {
      connected: TABLE_NAME ? true : false,
      table: TABLE_NAME || 'not-configured'
    },
    environment: {
      infura_configured: INFURA_API_KEY ? true : false,
      private_key_configured: PRIVATE_KEY ? true : false,
      contract_configured: CONTRACT_ADDRESS ? true : false,
      cognito_configured: USER_POOL_ID ? true : false,
      region: REGION
    }
  };
}

async function handleCognitoTrigger(event, context) {
  try {
    if (event.triggerSource === 'PostConfirmation_ConfirmSignUp') {
      const { userPoolId, userName, request } = event;
      const { userAttributes } = request;
      
      console.log('Processing Post Confirmation for user:', userName);
      
      const timestamp = new Date().toISOString();
      const email = userAttributes.email;
      const username = userAttributes.preferred_username || email.split('@')[0];
      
      await dynamoDB.put({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userAttributes.sub}`,
          SK: 'PROFILE',
          GSI1PK: 'TYPE#USER',
          GSI1SK: username,
          userId: userAttributes.sub,
          username: username,
          email: email,
          name: userAttributes.name || username,
          role: USER_ROLES.CONSUMER,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      }).promise();
      
      console.log('User profile saved to DynamoDB successfully');
    }
    
    return event;
  } catch (error) {
    console.error('Error handling Cognito Trigger:', error);
    return event;
  }
}

function formatResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    },
    body: JSON.stringify(body)
  };
}