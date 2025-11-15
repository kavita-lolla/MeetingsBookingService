const { execSync } = require('child_process');
const path = require('path');

module.exports = async () => {
    const sqlPath = path.join(__dirname, '../../infrastructure/database/teardown-test-data.sql');

  console.log('Running setup SQL:', sqlPath);
  execSync(`docker-compose exec -T postgres psql -U admin -d meetingbooking < ${sqlPath}`, { stdio: "inherit" });
};