// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ProductRegistry {
    struct Product {
        string name;
        string batch;
        string manufacturer;
        string status;
        uint256 timestamp;
        bool exists;
    }

    struct TraceRecord {
        string stage;
        string company;
        string location;
        uint256 timestamp;
        bool exists;
    }

    mapping(string => Product) public products;
    mapping(string => TraceRecord[]) public productTraces;
    mapping(string => uint256) public traceCount;

    event ProductRegistered(string productId, string name, string manufacturer);
    event ProductStatusUpdated(string productId, string newStatus);
    event TraceRecordAdded(string productId, string stage, string company, string location);

    modifier productExists(string memory productId) {
        require(products[productId].exists, "Product does not exist");
        _;
    }

    function registerProduct(
        string memory productId,
        string memory name,
        string memory batch,
        string memory manufacturer
    ) public {
        require(!products[productId].exists, "Product already exists");
        require(bytes(productId).length > 0, "Product ID cannot be empty");
        require(bytes(name).length > 0, "Product name cannot be empty");
        require(bytes(manufacturer).length > 0, "Manufacturer cannot be empty");

        products[productId] = Product({
            name: name,
            batch: batch,
            manufacturer: manufacturer,
            status: "Created",
            timestamp: block.timestamp,
            exists: true
        });

        emit ProductRegistered(productId, name, manufacturer);
    }

    function updateProductStatus(string memory productId, string memory newStatus) 
        public 
        productExists(productId) 
    {
        require(bytes(newStatus).length > 0, "Status cannot be empty");
        
        products[productId].status = newStatus;
        emit ProductStatusUpdated(productId, newStatus);
    }

    function addTraceRecord(
        string memory productId,
        string memory stage,
        string memory company,
        string memory location
    ) public productExists(productId) {
        require(bytes(stage).length > 0, "Stage cannot be empty");
        require(bytes(company).length > 0, "Company cannot be empty");
        require(bytes(location).length > 0, "Location cannot be empty");

        TraceRecord memory newTrace = TraceRecord({
            stage: stage,
            company: company,
            location: location,
            timestamp: block.timestamp,
            exists: true
        });

        productTraces[productId].push(newTrace);
        traceCount[productId] = productTraces[productId].length;

        emit TraceRecordAdded(productId, stage, company, location);
    }

    function getProduct(string memory productId)
        public
        view
        returns (
            string memory,
            string memory,
            string memory,
            string memory,
            uint256
        )
    {
        require(products[productId].exists, "Product not found");
        Product memory p = products[productId];
        return (p.name, p.batch, p.manufacturer, p.status, p.timestamp);
    }

    function getTraceRecord(string memory productId, uint256 index)
        public
        view
        returns (
            string memory,
            string memory,
            string memory,
            uint256
        )
    {
        require(products[productId].exists, "Product not found");
        require(index < productTraces[productId].length, "Trace record index out of bounds");
        
        TraceRecord memory trace = productTraces[productId][index];
        return (trace.stage, trace.company, trace.location, trace.timestamp);
    }

    function getTraceCount(string memory productId) 
        public 
        view 
        returns (uint256) 
    {
        require(products[productId].exists, "Product not found");
        return traceCount[productId];
    }

    function getAllTraces(string memory productId)
        public
        view
        returns (
            string[] memory stages,
            string[] memory companies,
            string[] memory locations,
            uint256[] memory timestamps
        )
    {
        require(products[productId].exists, "Product not found");
        
        uint256 count = productTraces[productId].length;
        stages = new string[](count);
        companies = new string[](count);
        locations = new string[](count);
        timestamps = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            TraceRecord memory trace = productTraces[productId][i];
            stages[i] = trace.stage;
            companies[i] = trace.company;
            locations[i] = trace.location;
            timestamps[i] = trace.timestamp;
        }

        return (stages, companies, locations, timestamps);
    }

    function productExistsCheck(string memory productId) 
        public 
        view 
        returns (bool) 
    {
        return products[productId].exists;
    }

    // Emergency function to verify contract integrity
    function getContractInfo() 
        public 
        pure 
        returns (string memory, string memory) 
    {
        return ("ProductRegistry", "2.0.0");
    }
}