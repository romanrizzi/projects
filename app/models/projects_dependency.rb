class ProjectsDependency < ApplicationRecord
  belongs_to :depender, class_name => 'ProjectsTask'
  belongs_to :dependee, class_name => 'ProjectsTask'
end
