/**
 * The meat of ChromeSal.
 **/


// Set up some globals
var debug = false;
var data = {};
data.sal_version = '';
var report = {};
report.MachineInfo = {};
report.MachineInfo.HardwareInfo = {};
var callbackCount = 0;
var callbackTotal = 14;
var doNotSend = true;
var appInventory = [];
var settingsSet = false;

var key = '';
var serverURL = '';
// TODO: Remove legacy checkin code here
var legacyCheckin = false;

function renderStatus(statusText) {
  try {
    document.getElementById('status').textContent = statusText;
  } catch(err) {
    console.log(statusText);
  }
}

async function getDeviceName() {
// Will attempt to getDeviceHostname (coming in 83), then getDeviceAssetId,
// and finally fallback to "Chrome OS Device" 
  try {
    chrome.enterprise.deviceAttributes.getDeviceHostname(async hostname => {
      data.name = hostname;
      if (data.name === '') {
        throw 'No Hostname returned';
      }
    });
  }
    catch(err) {
      if (debug === true){
        console.log('No Hostname');
        console.log(err);
      }
      try {
        // Now try AssetID
        chrome.enterprise.deviceAttributes.getDeviceAssetId(async assetId => {
          data.name = assetId;
          if (data.name === '') {
            throw 'No AssetId returned';
          }
        });
      }
      catch(err) {
        data.name = 'Chrome OS Device';
        if (debug === true){
          console.log('No AssetId');
          console.log(err);
        }
      }
    }
    callbackCount++;
}

function getConsoleUser(){
  chrome.identity.getProfileUserInfo(function(info){
    data.username = info.email;
    // console.log(info);
  });
  callbackCount++;
}

function getCPUInfo() {
  chrome.system.cpu.getInfo(sendBackCPUInfo);
}

function sendBackCPUInfo(info) {
  // console.log(info);
  var cpu_array = info.modelName.split('@');
  report.MachineInfo.HardwareInfo.cpu_type = cpu_array[0].trim();
  if (report.MachineInfo.HardwareInfo.cpu_type.endsWith('CPU')) {
    report.MachineInfo.HardwareInfo.cpu_type = report.MachineInfo.HardwareInfo.cpu_type.slice(0, -4).trim();
  }
  report.MachineInfo.HardwareInfo.current_processor_speed = cpu_array[1].trim();
  callbackCount++;
}

function getOsVersion() {
  userAgentString = navigator.userAgent;
	if (/Chrome/.test(userAgentString)) {
		report.MachineInfo.os_vers = userAgentString.match('Chrome/([0-9]*\.[0-9]*\.[0-9]*\.[0-9]*)')[1];
  } else {
    report.MachineInfo.os_vers = 'UNKNOWN';
  }
  callbackCount++;
}

// Used similar style as: https://source.chromium.org/chromiumos/chromiumos/codesearch/+/main:src/platform/factory/diagnosis-extension/extension/src/tests/info/info.js
// function getStorageInfo() {
//     const createStorageInfo = (index, elem) => {
//       const div = document.createElement('div');
//       div.id =  'hard-disk ' + index.toString();
//       div.appendChild(this.createListItem('Name: ' + elem.name));
//       div.appendChild(
//           this.createListItem('Capacity: ' +
//               this.convertBytes(elem.capacity).toString()));
//       return div;
//     };
// 
//     chrome.system.storage.getInfo((info) => {
//       if(!info) this.endTest(false, 'Cannot get Memory info');
//       const divStorage = document.createElement('h3');
//       divStorage.id = 'hard-disk';
//       for (const [index, elem] of info.entries()) {
//         if (elem.type === 'fixed') {
//           divStorage.appendChild(createStorageInfo(index, elem));
//         }
//       }
//       document.getElementById('info').appendChild(divStorage);
//     });
//   }


function sendBackStorageInfo(info) {
  callbackCount++;
  console.log(info);
  if (!Array.isArray(info) || !info.length) {
    if (debug === true) console.log("info is not array or info.length for storage is 0");
    report.AvailableDiskSpace = '1';
  } else {
    if (debug === true) console.log("info.length for storage is not 0 so it should report a size");
    if (debug === true) console.log(info);
    report.AvailableDiskSpace = info[0].capacity;
  }
}

function getStorageInfo() {
  chrome.system.storage.getInfo(sendBackStorageInfo);
}

function getMemInfo() {
  chrome.system.memory.getInfo(sendBackMem);
}

function sendBackMem(info) {
  if (debug === true) console.log(info);  
  report.MachineInfo.HardwareInfo.physical_memory = (info.capacity/1073741824).toFixed(2) + ' GB';
  report.MachineInfo.HardwareInfo.physical_memory_kb = (info.capacity/1024);
  callbackCount++;
}

function guid() {
  callbackCount++;
  data.run_uuid = s4() + s4() + '-' + s4() + '-' + s4() + '-' +
    s4() + '-' + s4() + s4() + s4();
}

function s4() {
  return Math.floor((1 + Math.random()) * 0x10000)
    .toString(16)
    .substring(1);
}
/* Two functions with the same name
function waitForSettings() {
  // Wait for settings to have run before carrying on
  if (settingsSet !== true) {
    console.log('Waiting for settings');
    setTimeout(waitForSettings, 1000);
  }
}
*/

function waitForSettings(callback) {
  if (settingsSet === true) {
    callback && callback();
  } else {
    setTimeout(waitForSettings, 1000, callback);
  }
}

async function continueExec() {
  data_check = await checkForData();
  //here is the trick, wait until var callbackCount is set number of callback functions
  if (doNotSend === true && debug === false) {
    notRunningMessage();
    return;
  }
  if (callbackCount < callbackTotal || data_check === false) {
    console.log('Waiting for data');
    setTimeout(continueExec, 1000);
    return;
  }
  //Finally, do what you need
  setTimeout(sendData, 2000);
}

function buildInventoryPlist(appInventory){
  var plistroot = []
  appInventory.forEach( function(extension){

    dict = {}
    dict.bundleid = extension.bundleid;
    dict.version = extension.version;
    dict.CFBundleName = extension.name;
    dict.name = extension.name;

    plistroot.push(dict)
  });

  plistroot = removeDuplicates(plistroot, 'bundleid')


  return PlistParser.toPlist(plistroot);

}

function addManagedInstalls(report, appInventory){

  if (report.hasOwnProperty('ManagedInstalls')) {
    return report;
  }
  // TODO: Remove legacy checkin code here
  if (legacyCheckin == true) {
    var root = [];
    appInventory.forEach( function(extension){
      if (extension.install_type == 'admin') {
        var dict = {}
        dict.name = extension.name;
        dict.display_name = extension.display_name;
        dict.installed = true;
        dict.installed_version = extension.version;
        dict.installed_size = 0;
        root.push(dict);
      }
    });
    report.ManagedInstalls = root;
  } else {
    report.ManagedInstalls = {}
    appInventory.forEach ( function(extension){
      // if (extension.install_type == 'admin') {
        report.ManagedInstalls[extension.name] = {
          'status': 'PRESENT',
          'data': {
            // 'type': "Extension",
            'type': extension.install_type,
            'installed_version': extension.version,
            'description': extension.description,
            'display_name': extension.bundleid
          }
        }
      // }
    });

    if (debug === true) console.log(report.ManagedInstalls);

  }

  return report;
}

function checkForData(){
  if (data.key === '') {
    return false;
  }

  if (data.serial === '') {
    return false;
  }

  if (serverURL === '') {
    return false;
  }

  if (data.sal_version === '') {
    return false;
  }

  if (data.sal_version === null) {
    return false;
  }

  if (settingsSet == false){
    return false
  }
}

function sal4ReportFormat(report){
  out = {};
  out.Machine = {};
  out.Chrome = {};
  new_report = {
      'serial': data.serial,
      'hostname': data.name,
      'console_user': data.username,
      'os_family': report.os_family,
      'operating_system': report.MachineInfo.os_vers,
      'hd_space': report.AvailableDiskSpace,
      'cpu_type': report.MachineInfo.HardwareInfo.cpu_type,
      'cpu_speed': report.MachineInfo.HardwareInfo.current_processor_speed,
      'memory': report.MachineInfo.HardwareInfo.physical_memory,
      'memory_kb': report.MachineInfo.HardwareInfo.physical_memory_kb,
      'machine_model': report.MachineInfo.HardwareInfo.machine_model,
      'machine_model_friendly': report.MachineInfo.HardwareInfo.machine_model
      
  };

  out.Machine.extra_data = new_report;
  if (debug === true) console.log(report.ManagedInstalls);
  out.Chrome.managed_items = report.ManagedInstalls;
  out.Sal = {}
  out.Chrome.facts = {'checkin_module_version': data.sal_version}
  out.Sal.facts = {'checkin_module_version': data.sal_version}
  out.Machine.facts = {
    'checkin_module_version': data.sal_version,
    'google_gevice_id': data.google_device_identifier,
    'ipv4_address': data.ipv4,
    'ipv6_address': data.ipv6
  };
  out.Sal.extra_data = {'key': data.key, 'sal_version': data.sal_version}
  // out.key = data.key
  return out
}

function sendData(){
  report.os_family = 'ChromeOS';
  report = addManagedInstalls(report, appInventory);

  // TODO: Remove legacy checkin code here
  if (legacyCheckin === true){
    var reportPlist = PlistParser.toPlist(report);
    data.base64report = btoa(reportPlist);
    if (debug===true){
      console.log(data);
    }
  } else{
    var reportJson = JSON.stringify(sal4ReportFormat(report))
    if (debug===true){
      console.log(reportJson);
    }
  }

  // TODO: Remove legacy checkin code here
  var inventoryPlist = buildInventoryPlist(appInventory);
  // console.log(reportPlist);
  // console.log(inventoryPlist)
  // console.log(buildInventoryPlist(appInventory));
  // console.log(data)
  // console.log(buildInventoryPlist(appInventory));
  // console.log("legacyCheckin: "+legacyCheckin)
  if (legacyCheckin === true){
  jQuery.ajax({
      type: "POST",
      url: serverURL + '/checkin/',
      data: data,
      beforeSend: function (xhr) {
        xhr.setRequestHeader ("Authorization", "Basic " + btoa("sal:" + data.key));
      },
      success: function(received) {
          console.log(received);
          data.base64inventory = btoa(unescape(encodeURIComponent(inventoryPlist)));
          jQuery.ajax({
              type: "POST",
              url: serverURL + '/inventory/submit/',
              data: data,
              beforeSend: function (xhr) {
                xhr.setRequestHeader ("Authorization", "Basic " + btoa("sal:" + data.key));
              },
              success: function(received) {
                console.log(received);
              },
              error: function(received) {
                console.log(received.responseText);
                console.log('Auth: ' + btoa("sal:" + data.key));
                console.log(data);
              },
          });
      },
      error: function(received) {
          console.log(received.responseText);
      }
  });
 } else {
  jQuery.ajax({
    type: "POST",
    url: serverURL + '/checkin/',
    data: reportJson,
    contentType:"application/json",
    dataType:"json",
    beforeSend: function (xhr) {
      xhr.setRequestHeader ("Authorization", "Basic " + btoa("sal:" + key));
    },
    success: function(received) {
        console.log(received);
        data.base64inventory = btoa(unescape(encodeURIComponent(inventoryPlist)));
        jQuery.ajax({
            type: "POST",
            url: serverURL + '/inventory/submit/',
            data: data,
            beforeSend: function (xhr) {
              xhr.setRequestHeader ("Authorization", "Basic " + btoa("sal:" + key));
            },
            success: function(received) {
              console.log(received);
            },
            error: function(received) {
              console.log(received.responseText);
              console.log('Auth: ' + btoa("sal:" + key));
              console.log(data);
            },
        });
    },
    error: function(received) {
        console.log(received.responseText);
    }
});
 }

}

async function getGoogleDeviceIdentifier() {
  // We are only going to run on a Chrome OS device
  chrome.runtime.getPlatformInfo(async function(info) {
    //console.log(info)
    if (!info.os.toLowerCase().includes('cros')){
      if (debug === false) {
        console.log('Not cros and not debug')
        doNotSend = true;
      }
    }
  });
  try {
      chrome.enterprise.deviceAttributes.getDirectoryDeviceId(async google_deviceId => {
        if (debug === true) renderStatus(google_deviceId);
        if (debug === true) console.log(google_deviceId);
        data.google_device_identifier = google_deviceId.toUpperCase();
        if (data.google_device_identifier === '') {
          throw 'No Google Identifier returned'
          if (debug === false) {
            console.log('setting do not send to true due to no serial being returned and not being debug')
              doNotSend = true;
          }
        }
      });
  }
    catch(err) {
      data.google_device_identifier = 'abc123'.toUpperCase();
      console.log('Not a managed chrome device');
      if (debug === true){
        console.log(err);
      }
      if (debug === false) {
        console.log('setting do not send to true due to no serial error and not being debug')
        doNotSend = true;
      }
    }
    callbackCount++;
}

async function getDeviceSerial() {
  // We are only going to run on a Chrome OS device
  chrome.runtime.getPlatformInfo(async function(info) {
    if (debug === true) console.log(info)
    if (!info.os.toLowerCase().includes('cros')){
      if (debug === false) {
        console.log('Not cros and not debug')
        doNotSend = true;
      }
    }
  });
  try {
      chrome.enterprise.deviceAttributes.getDeviceSerialNumber(async serialNumber => {
        if (debug === true) renderStatus(serialNumber);
        if (debug === true) console.log(serialNumber);
          data.serial = serialNumber.toUpperCase();
          if (data.serial === '') {
            throw 'No Serial returned'
            if (debug === false) {
              console.log('setting do not send to true due to no serial being returned and not being debug')
              doNotSend = true;
            }
          }
      });
    }
    catch(err) {
      data.serial = 'abc123'.toUpperCase();
      console.log('Not a managed chrome device');
      if (debug === true){
        console.log(err);
      }
      if (debug === false) {
        console.log('setting do not send to true due to no serial error and not being debug')
        doNotSend = true;
      }
    }
    callbackCount++;
}

async function getHardwarePlatform() {
  // We are only going to run on a Chrome OS device
  chrome.runtime.getPlatformInfo(async function(info) {
    if (debug === true) console.log(info)
    if (!info.os.toLowerCase().includes('cros')){
      if (debug === false) {
        console.log('Not cros and not debug');
        doNotSend = true;
      }
    }
  });
  try {
      chrome.enterprise.hardwarePlatform.getHardwarePlatformInfo(async function(info) {
          if (!info || info === 'undefined') throw 'No Hardware info returned (empty)';
          // if (!Array.isArray(info) || !info.length) throw 'No Hardware info returned (Not array or length 0)';
          if (debug === true) renderStatus(info);
          if (debug === true) console.log(info);
          var make = info.manufacturer;
          var model = info.model;
          report.MachineInfo.HardwareInfo.machine_model = make + ' ' + model;
          if (report.MachineInfo.HardwareInfo.machine_model === '') {
            throw 'No Hardware info returned (report empty)';
            if (debug === false) {
              console.log('setting do not send to true due to no Hardware info being returned and not being debug');
              doNotSend = true;
            }
          }
// Tries to catch the runtime error since ChromeOS doesn't have permissions for this API call yet
// https://stackoverflow.com/questions/26517988/unchecked-runtime-lasterror-while-running-tabs-executescript/45603880#45603880
      }, _=>{
        let e = chrome.runtime.lastError;
        if(e !== undefined){
          if (debug === true) console.error ("Caught error doing: chrome.enterprise.hardwarePlatform.getHardwarePlatformInfo");
          console.log(info, _, e);
          report.MachineInfo.HardwareInfo.machine_model = 'Chrome OS Device';
        }
      });
    }
    catch(err) {
      report.MachineInfo.HardwareInfo.machine_model = 'Chrome OS Device';
      if (debug === true) console.log(err);
      if (debug === false) {
        console.log('setting do not send to true due to no Hardware info error and not being debug');
        doNotSend = true;
      }
    }
    callbackCount++;
}

async function getNetworkInfo() {
  // We are only going to run on a Chrome OS device
  chrome.runtime.getPlatformInfo(async function(info) {
    if (debug === true) console.log(info);
    if (!info.os.toLowerCase().includes('cros')){
      if (debug === false) {
        console.log('Not cros and not debug');
        doNotSend = true;
      }
    }
  });
  try {
    chrome.enterprise.networkingAttributes.getNetworkDetails(async function(info) {
          if (!info || info === 'undefined') throw 'No networking info returned (empty)';
          // if (!Array.isArray(info) || !info.length) throw 'No Hardware info returned (Not array or length 0)';
//           renderStatus(info);
          if (debug === true) console.log(info);
          data.ipv4 = info.ipv4;
          data.ipv6 = info.ipv6;
          if (data.ipv4 === '') {
            throw 'No network info returned (report empty)';
            if (debug === false) {
              console.log('setting do not send to true due to no network info being returned and not being debug');
              doNotSend = true;
            }
          }
// Tries to catch the runtime error since this is where the API puts errors for not network connected
// https://stackoverflow.com/questions/26517988/unchecked-runtime-lasterror-while-running-tabs-executescript/45603880#45603880
      }, _=>{
        let e = chrome.runtime.lastError;
        if(e !== undefined){
          if (debug === true) console.error ("Caught error doing: chrome.enterprise.networkingAttributes.getNetworkDetails");
          console.log(info, _, e);
        }
      });
    }
    catch(err) {
      if (debug === true){
        console.log(err);
      }
      if (debug === false) {
        console.log('setting do not send to true due to no network info error and not being debug');
        doNotSend = true;
      }
    }
    callbackCount++;
}

function getExtensionVersion() {
  callbackCount++;
  chrome.runtime.getPackageDirectoryEntry(function (dirEntry) {
    dirEntry.getFile("manifest.json", undefined, function (fileEntry) {
    fileEntry.file(function (file) {
            var reader = new FileReader()
            reader.addEventListener("load", function (event) {
                // data now in reader.result
                if (debug === true) console.log(reader.result);
                var manifest = JSON.parse(reader.result);
                data.sal_version =  manifest.version;
                if (doNotSend == false){
                  renderStatus('Running chromesal ' +data.sal_version);
                }
            });
            reader.readAsText(file);
        });
    }, function (e) {
        console.log(e);
    });
  });

}

function removeDuplicates( arr, prop ) {
  let obj = {};
  return Object.keys(arr.reduce((prev, next) => {
    if(!obj[next[prop]]) obj[next[prop]] = next;
    return obj;
  }, obj)).map((i) => obj[i]);
}

function getExtensions() {
    chrome.management.getAll(function(info){
    // Extensions

    if (appInventory != []) {

      info.forEach( function(extension){
        if (debug === true) console.log(extension);
        var inventory_item = {};
        inventory_item.name = extension.name;
        inventory_item.bundleid = extension.id;
        inventory_item.version = extension.version;
        inventory_item.install_type = extension.installType;
        inventory_item.description = extension.description;
        appInventory.push(inventory_item)
      });
    }

    callbackCount++;
    console.log('Extension list callback');
    });
}

function getSettings(){
  chrome.runtime.getPackageDirectoryEntry(function (dirEntry) {
    dirEntry.getFile("settings.json", undefined, function (fileEntry) {
    fileEntry.file(function (file) {
            var reader = new FileReader()
            reader.addEventListener("load", function (event) {
                // data now in reader.result
                var settings = JSON.parse(reader.result);
                if (debug === true) console.log('Using local settings file');
                if (debug === true) console.log(settings.debug);
                data.key = settings.key;
                key = settings.key;
                serverURL = settings.serverurl;
                debug = settings.debug;
                legacyCheckin = settings.legacycheckin;
                callbackCount++;
                settingsSet = true;
                return;
            });
            reader.readAsText(file);
        });
    }, function (e) {
        console.log(e);
    });
  });
  chrome.storage.managed.get(null, function(adminConfig) {
    if (debug === true){
      console.log("chrome.storage.managed.get adminConfig: ", adminConfig);
    }
    data.key = adminConfig['key'];
    key = adminConfig['key'];
    serverURL = adminConfig['serverurl'];
    // TODO: Remove legacy checkin code here
    if ("legacycheckin" in adminConfig) {
      legacyCheckin = adminConfig['legacycheckin'];
    }

    settingsSet = true;
    callbackCount++;
  });
}

function notRunningMessage() {
  console.log('Not running on a managed device, not sending report');
  renderStatus('Only functional on a managed Chrome OS device');
  chrome.browserAction.setIcon({
    path : "./icons/inactive_128.png"
  });
}

function main() {

  getSettings();
  waitForSettings(function() {
  guid();
  getExtensionVersion();
  getHardwarePlatform();
  getNetworkInfo();
  getDeviceSerial();
  getGoogleDeviceIdentifier();
  getDeviceName();
  getCPUInfo();
  getStorageInfo();
  getOsVersion();
  getMemInfo();
  getExtensions();
  getConsoleUser();

  continueExec();
  });

}

document.addEventListener('DOMContentLoaded', function() {
  main()
});
