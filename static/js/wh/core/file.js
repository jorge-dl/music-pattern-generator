/**
 * Saves state to - or restores it from localstorage.
 * Saves state to file, opens external files.
 * 
 * @namespace WH
 */
window.WH = window.WH || {};

(function (ns) {
    
    /**
     * @description Creates a transport object.
     */
    function createFile(specs) {
        var that,
            midi = specs.midi,
            midiNetwork = specs.midiNetwork,
            midiRemote = specs.midiRemote,
            transport = specs.transport,
            projectName = 'project',
            preferencesName = 'preferences',

            /**
             * Autosave file if true.
             * @type {Boolean}
             */
            autoSaveEnabled = true,
            
            init = function() {
                window.addEventListener('beforeunload', onBeforeUnload);
            },
            
            /**
             * Setup on application start.
             */
            setup = function() {
                loadPreferences();
                if (!loadProjectFromStorage()) {
                    createNew();
                }
            },
            
            /**
             * Get the stored preferences, if any.
             */
            loadPreferences = function() {
                var data = localStorage.getItem(preferencesName);
                if (data) {
                    data = JSON.parse(data);
                    midi.setData(data.midi);
                } else {
                    console.log('No data in LocalStorage with name "' + preferencesName + '".');
                }
            },
            
            /**
             * Save application preferences to localStorage.
             * @param {Object} data Object with preferences data to save.
             */
            savePreferences = function() {
                var data = {
                    midi: midi.getData()
                };
                localStorage.setItem(preferencesName, JSON.stringify(data));
            },
            
            /**
             * Create data to setup a new empty project.
             */
            createNew = function() {
                midiRemote.clear();
                midiNetwork.clear();
                transport.setBPM(120);
            },

            /**
             * Load project from localStorage.
             * @return {Boolean} True if a project was found in localstorage.
             */
            loadProjectFromStorage = function() {
                var data = localStorage.getItem(projectName);
                if (data) {
                    data = JSON.parse(data);
                    setData(data);
                } else {
                    console.log('No data in LocalStorage with name "' + projectName + '".');
                    return false;
                }
                return true;
            },

            /**
             * Save project if autoSave is enabled.
             */
            autoSave = function() {
                if (autoSaveEnabled) {
                    save();
                }
            },

            /**
             * Collect all project data and save it in localStorage.
             */
            save = function() {
                let data = getData();
                console.log(data);
                localStorage.setItem(projectName, JSON.stringify(data));
            }, 
            
            /**
             * Save the preferences when the page unloads.
             */
            onBeforeUnload = function(e) {
                savePreferences();
                autoSave();
            },
            
            getData = function() {
                return {
                    bpm: transport.getBPM(),
                    network: midiNetwork.getData(),
                    remote: midiRemote.getData()
                };
            },
            
            setData = function(data) {
                console.log(data);
                transport.setBPM(data.bpm);
                midiNetwork.setData(data.network);
                midiRemote.setData(data.remote);
            },
            
            importFile = function(file) {
                let fileReader = new FileReader();
                // closure to capture the file information
                fileReader.onload = (function(f) {
                    return function(e) {
                        try {
                            let data = JSON.parse(e.target.result);
                            setData(data);
                        } catch(e) {
                            console.log(e);
                        }
                    };
                })(file);
                fileReader.readAsText(file);
            },
            
            
            exportFile = function() {
                let jsonString = JSON.stringify(getData()),
                    blob = new Blob([jsonString], {type: 'application/json'}),
                    a = document.createElement('a');
                a.download = 'epg.json';
                a.href = URL.createObjectURL(blob);
                a.click();
            };
        
        that = specs.that;
        
        init();
        
        that.setup = setup;
        that.createNew = createNew;
        that.autoSave = autoSave;
        that.save = save;
        that.importFile = importFile;
        that.exportFile = exportFile;
        return that;
    }
    
    ns.createFile = createFile;

})(WH);
