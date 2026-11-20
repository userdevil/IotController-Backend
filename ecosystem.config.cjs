module.exports = {
  apps: [
    {
      name: 'iot-controller-backend',
      cwd: '/home/mavin-sandeep/IotController-Backend',
      script: 'src/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 8085,
      },
      max_memory_restart: '300M',
      autorestart: true,
    },
  ],
};
