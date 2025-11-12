import Homey from 'homey';
import { HomeyAPI } from 'homey-api';
import { Sequelize, DataTypes } from 'sequelize';

export default class TimescaleDBApp extends Homey.App {

  async onInit() {
    const timescaleUri = 'postgres://root:toor@192.168.1.216:5432/homey';
    this.sequelize = new Sequelize(timescaleUri, {
      dialect: 'postgres',
      protocol: 'postgres',
      logging: false,
      dialectOptions: timescaleUri.includes('cloud.timescale.com')
        ? {
          ssl: {
            require: true,
            rejectUnauthorized: false,
          },
        }
        : {},
    });

    await this.sequelize.authenticate();
    this.log('Connected to TimescaleDB.');

    // Create model for Entry
    this.table = this.sequelize.define('entry', {
      homey_id: {
        type: Sequelize.STRING(24), // Homey ID
        primaryKey: true,
      },
      device_id: {
        type: Sequelize.STRING(36), // Device ID
        primaryKey: true,
      },
      capability_id: {
        type: Sequelize.STRING(1000), // Capability ID
        primaryKey: true,
      },
      time: {
        type: Sequelize.DATE,
        primaryKey: true,
      },
      value: {
        type: Sequelize.DECIMAL,
      },
    }, {
      tableName: 'homey',
      timestamps: false,
    });

    // Ensure table exists
    await this.table.sync();
    this.log('Homey table is ready.');

    // Ensure table is a HyperTable
    await this.sequelize
      .query("SELECT create_hypertable('homey', 'time', if_not_exists => TRUE);")
      .catch((err) => this.logger.error(err));

    // Enable Compression
    await this.sequelize.query("ALTER TABLE homey SET (timescaledb.compress, timescaledb.compress_segmentby = 'homey_id, device_id, capability_id');").catch(err => this.error(`Error Enabling Compression: ${err}`));
    await this.sequelize.query("SELECT add_compression_policy('homey', INTERVAL '7 days', if_not_exists => TRUE);").catch(err => this.error(`Error Adding Compression Policy: ${err}`));
    this.log('Compression enabled on Homey table.');

    // Get Homey ID
    this.homeyId = await this.homey.cloud.getHomeyId();

    // Initialize Homey API
    this.homeyApi = await HomeyAPI.createAppAPI({
      homey: this.homey,
    });

    // Connect to ManagerDevices
    await this.homeyApi.devices.connect();

    // Initialize all Devices
    const devices = await this.homeyApi.devices.getDevices();
    for (const device of Object.values(devices)) {
      this.__initDevice(device);
    }

    // Initialize new Devices
    this.homeyApi.devices.on('device.create', device => {
      this.__initDevice(device);
    });


    this.log('TimescaleDBApp has been initialized');
  }

  __initDevice(device) {
    const deviceId = device.id;
    Promise.resolve().then(async () => {
      await device.connect();

      device.on('capability', ({ capabilityId, value }) => {
        this.log(`[Device:${deviceId}][Capability:${capabilityId}] Changed to ${value}`);

        if (typeof value === 'boolean') {
          value = value ? 1 : 0;
        }

        if (typeof value !== 'number') return;

        this.table.create({
          homey_id: this.homeyId,
          device_id: deviceId,
          capability_id: capabilityId,
          value,
          time: new Date().getTime(),
        }).catch(err => this.error(`Error inserting entry: ${err}`));
      });
    })
      .then(() => this.log(`[Device:${deviceId}] Initialized`))
      .catch(err => this.error(`[Device:${deviceId}] Error Initializing: ${err}`));

  }

};
