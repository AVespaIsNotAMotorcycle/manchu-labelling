// Runs once, when MongoDB starts with an empty data folder. The API gets its own user, which can only
// read and write the app's database.
db.getSiblingDB("manchu-labelling").createUser({
  user: "app",
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: "readWrite", db: "manchu-labelling" }],
});
