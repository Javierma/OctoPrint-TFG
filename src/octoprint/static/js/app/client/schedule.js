(function (global, factory) {
    if (typeof define === "function" && define.amd) {
        define(["OctoPrint"], factory);
    } else {
        factory(window.OctoPrint);
    }
})(window || this, function(OctoPrint) {
    var url = "api/schedule";

    OctoPrint.schedule = {
        listAllScheduledJobs: function(opts) {
            return OctoPrint.get(url,opts);
        },

        programNewJob: function(data) {
            return OctoPrint.putJson(url+"/program_print",data);
        },

        deleteJob: function(data) {
            return OctoPrint.putJson(url+"/delete_job",data);
        }
    }
});
