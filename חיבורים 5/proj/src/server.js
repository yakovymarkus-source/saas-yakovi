const app = require("./app");
const { createUser, getUserById } = require("./repositories/userRepository");

async function seedDefaultUser() {
  const existing = await getUserById("user_1");
  if (!existing) {
    await createUser({
      id: "user_1",
      email: "test@test.com",
      analysis_history: [],
      campaigns: []
    });
  }
}

async function start() {
  await seedDefaultUser();
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`running on port ${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
