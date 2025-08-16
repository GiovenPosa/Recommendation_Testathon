const mongoose = require('mongoose');

const MONGO_URI = 'mongodb://appuser1:appuser1@ac-pzmwfhj-shard-00-00.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-01.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-02.jxzjzuo.mongodb.net:27017/recommendation_dataset?ssl=true&replicaSet=atlas-tq5bms-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0';

async function connectDB() {
  mongoose.set('strictQuery', false);
  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    family: 4,              // prefer IPv4 (hotspot-friendly)
    maxPoolSize: 10,
  });
  console.log('✅ Mongo connected');
}

module.exports = { connectDB };