const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const Web3 = require('web3');

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const cognito = new AWS.CognitoIdentityServiceProvider();

// Blockchain Configuration
const INFURA_API_KEY = process.env.INFURA_API_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const web3 = new Web3(`https://sepolia.infura.io/v3/${INFURA_API_KEY}`);

// Contract ABI (từ ProductRegistry.sol)
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
    "inputs": [{"name": "productId", "type": "string"}],
    "name": "getProduct",
    "outputs": [{"name": "", "type": "string"}, {"name": "", "type": "string"}, {"name": "", "type": "string"}, {"name": "", "type": "string"}, {"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
];

// Initialize blockchain account
const account = web3.eth.accounts.privateKeyToAccount('0x' + PRIVATE_KEY);
web3.eth.accounts.wallet.add(account);
const contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);

// Constants
const TABLE_NAME = process.env.DYNAMODB_TABLE;
const REGION = process.env.AWS_REGION || 'ap-southeast-1';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;

// User roles
const USER_ROLES = {
  CONSUMER: 'consumer',
  MANUFACTURER: 'manufacturer',
  RETAILER: 'retailer'
};

const originalHandler = async (event) => {
  console.log('API Gateway Event:', JSON.stringify(event, null, 2));

  try {
    const { requestContext, pathParameters, queryStringParameters, body } = event;
    
    const httpMethod = event.httpMethod || (event.requestContext?.http?.method);
    const routeKey = event.routeKey || `${httpMethod} ${event.resource}`;
    const path = event.path || event.resource || routeKey?.split(' ')[1];
    
    // Extract user ID from Cognito JWT token
    let userId = 'anonymous';
    let userRole = null;
    if (requestContext?.authorizer?.jwt?.claims?.sub) {
      userId = requestContext.authorizer.jwt.claims.sub;
      userRole = requestContext.authorizer.jwt.claims['custom:user_role'];
    } else if (requestContext?.authorizer?.claims?.sub) {
      userId = requestContext.authorizer.claims.sub;
      userRole = requestContext.authorizer.claims['custom:user_role'];
    }
    
    const parsedBody = body ? (typeof body === 'string' ? JSON.parse(body) : body) : {};

    let response;
    
    // User Management Routes
    if (path === '/users/me' && httpMethod === 'GET') {
      response = await getUserProfile(userId);
    }
    else if (path === '/users/update-role' && httpMethod === 'POST') {
      response = await updateUserRole(userId, parsedBody);
    }
    
    // Product Management Routes with Blockchain
    else if (path === '/products' && httpMethod === 'GET') {
      response = await getProducts(userId, userRole, queryStringParameters);
    }
    else if (path === '/products' && httpMethod === 'POST') {
      response = await createProductWithBlockchain(userId, userRole, parsedBody);
    }
    else if (path?.startsWith('/products/') && httpMethod === 'GET') {
      const productId = pathParameters?.id;
      response = await getProductWithBlockchain(userId, userRole, productId);
    }
    else if (path?.startsWith('/products/') && httpMethod === 'PUT') {
      const productId = pathParameters?.id;
      response = await updateProductWithBlockchain(userId, userRole, productId, parsedBody);
    }
    else if (path?.startsWith('/products/') && httpMethod === 'DELETE') {
      const productId = pathParameters?.id;
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
      response = await createOrderWithBlockchain(userId, userRole, parsedBody);
    }
    else if (path?.startsWith('/orders/') && httpMethod === 'PUT') {
      const orderId = pathParameters?.id;
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
    
    else {
      return formatResponse(404, { message: 'Route not found' });
    }

    return formatResponse(200, response);
  } catch (error) {
    console.error('Error:', error);
    
    if (error.code === 'ConditionalCheckFailedException') {
      return formatResponse(400, { message: 'Item does not exist or you do not have permission' });
    }
    
    return formatResponse(500, { message: 'Internal server error', error: error.message });
  }
};

exports.handler = async (event, context) => {
  // Handle Cognito Triggers
  if (event.triggerSource && event.version) {
    console.log('Cognito Trigger Event:', JSON.stringify(event, null, 2));
    return handleCognitoTrigger(event, context);
  }
  
  return originalHandler(event);
};

// Blockchain Integration Functions
async function registerProductOnBlockchain(productId, name, batch, manufacturer) {
  try {
    const gasEstimate = await contract.methods.registerProduct(productId, name, batch, manufacturer).estimateGas({
      from: account.address
    });
    
    const tx = await contract.methods.registerProduct(productId, name, batch, manufacturer).send({
      from: account.address,
      gas: Math.round(gasEstimate * 1.2),
      gasPrice: await web3.eth.getGasPrice()
    });
    
    console.log('Product registered on blockchain:', tx.transactionHash);
    return tx.transactionHash;
  } catch (error) {
    console.error('Blockchain registration error:', error);
    throw new Error('Failed to register product on blockchain: ' + error.message);
  }
}

async function updateProductStatusOnBlockchain(productId, status) {
  try {
    const gasEstimate = await contract.methods.updateProductStatus(productId, status).estimateGas({
      from: account.address
    });
    
    const tx = await contract.methods.updateProductStatus(productId, status).send({
      from: account.address,
      gas: Math.round(gasEstimate * 1.2),
      gasPrice: await web3.eth.getGasPrice()
    });
    
    console.log('Product status updated on blockchain:', tx.transactionHash);
    return tx.transactionHash;
  } catch (error) {
    console.error('Blockchain status update error:', error);
    throw new Error('Failed to update product status on blockchain: ' + error.message);
  }
}

async function getProductFromBlockchain(productId) {
  try {
    const result = await contract.methods.getProduct(productId).call();
    
    return {
      name: result[0],
      batch: result[1],
      manufacturer: result[2],
      status: result[3],
      timestamp: parseInt(result[4])
    };
  } catch (error) {
    console.error('Blockchain read error:', error);
    return null;
  }
}

// Enhanced Product Management with Blockchain
async function createProductWithBlockchain(userId, userRole, productData) {
  if (userRole !== USER_ROLES.MANUFACTURER) {
    throw new Error('Only manufacturers can create products');
  }
  
  const { name, category, description, quantity = 0, price = 0, batch } = productData;
  
  if (!name || !category || !batch) {
    throw new Error('Product name, category, and batch are required');
  }
  
  // Get user info
  const userInfo = await getUserProfile(userId);
  
  const productId = uuidv4();
  const timestamp = new Date().toISOString();
  
  try {
    // Register on blockchain first
    const txHash = await registerProductOnBlockchain(
      productId, 
      name, 
      batch, 
      userInfo.name || userInfo.username
    );
    
    // Save to DynamoDB with blockchain reference
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
      manufacturer: userInfo.name || userInfo.username,
      manufacturerId: userId,
      blockchainTxHash: txHash,
      blockchainStatus: 'registered',
      createdAt: timestamp,
      updatedAt: timestamp
    };
    
    await dynamoDB.put({
      TableName: TABLE_NAME,
      Item: productItem
    }).promise();
    
    return {
      message: 'Product created and registered on blockchain successfully',
      product: {
        id: productId,
        name,
        category,
        description,
        batch,
        quantity: parseInt(quantity) || 0,
        price: parseInt(price) || 0,
        manufacturer: userInfo.name || userInfo.username,
        blockchainTxHash: txHash,
        createdAt: timestamp
      }
    };
  } catch (error) {
    console.error('Error creating product with blockchain:', error);
    throw new Error('Failed to create product: ' + error.message);
  }
}

async function getProductWithBlockchain(userId, userRole, productId) {
  if (!productId) {
    throw new Error('Product ID is required');
  }
  
  // Get from DynamoDB first
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
    
    // Get blockchain data for verification
    const blockchainData = await getProductFromBlockchain(productId);
    
    return {
      id: item.productId,
      name: item.name,
      category: item.category,
      description: item.description,
      batch: item.batch,
      quantity: item.quantity,
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
  if (userRole !== USER_ROLES.MANUFACTURER) {
    throw new Error('Only manufacturers can update products');
  }
  
  const { status } = updateData;
  
  if (status) {
    try {
      // Update status on blockchain
      const txHash = await updateProductStatusOnBlockchain(productId, status);
      
      // Update DynamoDB
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
  
  // Handle other updates (same as original function)
  const timestamp = new Date().toISOString();
  const { name, category, description, quantity, price } = updateData;
  
  let updateExpression = 'SET updatedAt = :updatedAt';
  let expressionAttributeValues = { ':updatedAt': timestamp };
  let expressionAttributeNames = {};
  
  if (name) {
    updateExpression += ', #name = :name';
    expressionAttributeNames['#name'] = 'name';
    expressionAttributeValues[':name'] = name;
  }
  
  if (category) {
    updateExpression += ', category = :category';
    expressionAttributeValues[':category'] = category;
  }
  
  if (description !== undefined) {
    updateExpression += ', description = :description';
    expressionAttributeValues[':description'] = description;
  }
  
  if (quantity !== undefined) {
    updateExpression += ', quantity = :quantity';
    expressionAttributeValues[':quantity'] = parseInt(quantity) || 0;
  }
  
  if (price !== undefined) {
    updateExpression += ', price = :price';
    expressionAttributeValues[':price'] = parseInt(price) || 0;
  }
  
  await dynamoDB.update({
    TableName: TABLE_NAME,
    Key: {
      PK: `USER#${userId}`,
      SK: `PRODUCT#${productId}`
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
    ExpressionAttributeValues: expressionAttributeValues,
    ConditionExpression: 'attribute_exists(PK)'
  }).promise();
  
  return { message: 'Product updated successfully' };
}

async function verifyProductOnBlockchain(productCode) {
  if (!productCode) {
    throw new Error('Product code is required');
  }
  
  try {
    // Get product from blockchain
    const blockchainData = await getProductFromBlockchain(productCode);
    
    if (!blockchainData) {
      return {
        verified: false,
        message: 'Product not found on blockchain'
      };
    }
    
    // Get additional data from DynamoDB
    const dbProduct = await getProductWithBlockchain(null, null, productCode);
    
    return {
      verified: true,
      productId: productCode,
      blockchainData: blockchainData,
      databaseData: dbProduct,
      verificationTime: new Date().toISOString()
    };
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
    // Get blockchain verification
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
        date: item.timestamp.split('T')[0],
        location: item.details?.location || 'N/A',
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

// Original functions (getUserProfile, updateUserRole, etc.) remain the same...
// [Include all the original functions from the paste.txt here]

async function getUserProfile(userId) {
  const params = {
    TableName: TABLE_NAME,
    Key: {
      PK: `USER#${userId}`,
      SK: 'PROFILE'
    }
  };

  const result = await dynamoDB.get(params).promise();
  
  if (!result.Item) {
    return {
      userId: userId,
      username: "user_" + userId.substring(0, 8),
      role: USER_ROLES.CONSUMER
    };
  }
  
  return {
    userId: result.Item.userId,
    username: result.Item.username,
    email: result.Item.email,
    name: result.Item.name,
    role: result.Item.role,
    createdAt: result.Item.createdAt
  };
}

// Handle Cognito Trigger (same as original)
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
          role: USER_ROLES.CONSUMER, // Default role
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

// Helper function to format API responses
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