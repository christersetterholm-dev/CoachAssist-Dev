const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const configPath = path.join(__dirname, 'deploy-config.json');
let config = {
  host: 'coachassist.setterholm.se',
  port: 22,
  username: 'setterho',
  password: '',
  remotePath: '/home/setterho/coachassist.setterholm.se'
};

if (fs.existsSync(configPath)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = { ...config, ...loaded };
  } catch (e) {
    console.warn('Could not read deploy-config.json:', e.message);
  }
}

// Allow overriding from CLI / ENV
config.host = process.env.SSH_HOST || config.host;
config.port = Number(process.env.SSH_PORT || config.port);
config.username = process.env.SSH_USER || config.username;
config.password = process.env.SSH_PASSWORD || config.password;
config.remotePath = process.env.SSH_REMOTE_PATH || config.remotePath;

const zipFile = path.join(__dirname, 'coachassist-production-bundle.zip');

if (!fs.existsSync(zipFile)) {
  console.log('Building production bundle first...');
  require('./run-build.cjs');
}

if (!config.password && !config.privateKey && !process.env.SSH_PASSWORD) {
  console.error('\n❌ Error: No SSH password or private key specified.');
  console.log('You can provide it via environment variable:');
  console.log('  SSH_PASSWORD="your_password" npm run deploy\n');
  console.log('Or use the 1-click deploy button directly inside CoachAssist Admin Panel (Database & Miljö)!');
  process.exit(1);
}

console.log(`Connecting to ${config.username}@${config.host}:${config.port}...`);
const conn = new Client();

conn.on('ready', () => {
  console.log('SSH connection established successfully!');
  console.log('Uploading coachassist-production-bundle.zip via SFTP...');

  conn.sftp((err, sftp) => {
    if (err) {
      console.error('SFTP error:', err);
      conn.end();
      process.exit(1);
    }

    const remoteZip = path.posix.join(config.remotePath, 'coachassist-update.zip');
    sftp.fastPut(zipFile, remoteZip, (uploadErr) => {
      if (uploadErr) {
        console.error('Upload failed:', uploadErr);
        conn.end();
        process.exit(1);
      }

      console.log('Upload complete! Extracting files and restarting application...');
      const cmd = `unzip -qo "${remoteZip}" -d "${config.remotePath}" && rm -f "${remoteZip}" && mkdir -p "${config.remotePath}/tmp" && touch "${config.remotePath}/tmp/restart.txt"`;

      conn.exec(cmd, (execErr, stream) => {
        if (execErr) {
          console.error('Exec error:', execErr);
          conn.end();
          process.exit(1);
        }

        stream.on('close', (code) => {
          conn.end();
          if (code === 0) {
            console.log('\n🎉 [DEPLOY SUCCESSFUL]');
            console.log('CoachAssist was updated and restarted on your server in 2 seconds!');
            console.log('Live site: https://' + config.host);
            process.exit(0);
          } else {
            console.error(`Command exited with code ${code}`);
            process.exit(code || 1);
          }
        }).on('data', (data) => {
          process.stdout.write(data);
        }).stderr.on('data', (data) => {
          process.stderr.write(data);
        });
      });
    });
  });
}).on('error', (err) => {
  console.error('SSH Connection failed:', err.message);
  process.exit(1);
});

const connectOpts = {
  host: config.host,
  port: config.port,
  username: config.username,
  readyTimeout: 20000
};

if (config.password) connectOpts.password = config.password;
if (config.privateKey) connectOpts.privateKey = config.privateKey;

conn.connect(connectOpts);
